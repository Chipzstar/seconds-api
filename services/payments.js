const { DELIVERY_TYPES } = require('../constants');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const moment = require('moment');
const { COMMISSION } = require('@seconds-technologies/database_schemas/constants');

const confirmCharge = async (
	{ stripeCustomerId, subscriptionId },
	{ standardMonthly, standardCommission, multiDropCommission },
	jobInfo,
	quantity = 1
) => {
	try {
		console.table({
			customerId: stripeCustomerId,
			commissionCharge: jobInfo.commissionCharge,
			deliveryFee: jobInfo.deliveryFee,
			deliveryType: jobInfo.deliveryType,
			standardMonthly,
			standardCommission,
			multiDropCommission
		});
		// look up the plan for the active standard monthly subscription item
		const subscriptionItem = await stripe.subscriptionItems.retrieve(standardMonthly);
		const isStarter = subscriptionItem ? subscriptionItem.price.lookup_key === COMMISSION.CONNECT.name : null;
		const amount = isStarter ? Math.round(jobInfo.deliveryFee * 100 * 1.1) : Math.round(jobInfo.deliveryFee * 100);
		const description = isStarter ? `${jobInfo.description} (+10% commission)` : jobInfo.description;
		// Create invoice item to be added to the customer's next upcoming invoice
		const invoiceItem = await stripe.invoiceItems.create({
			customer: stripeCustomerId,
			amount,
			currency: 'gbp',
			description,
			subscription: subscriptionId,
			period: {
				start: moment().unix(),
				end: moment().add(1, 'day').unix()
			},
			tax_rates: [String(process.env.STRIPE_TAX_INCLUSIVE)]
		});
		console.log('----------------------------------------------');
		console.log('Delivery Fee added to next invoice!');
		console.log(invoiceItem);
		console.log('----------------------------------------------');
		if (standardCommission && jobInfo.commissionCharge) {
			let usageRecord = await stripe.subscriptionItems.createUsageRecord(standardCommission, {
				quantity,
				action: 'increment',
				timestamp: Math.ceil(Date.now() / 1000)
			});
			console.log('------------------------------');
			console.log('USAGE RECORD');
			console.table(usageRecord);
			console.log('------------------------------');
		}
		return Promise.resolve(true);
	} catch (e) {
		throw e;
	}
};

module.exports = confirmCharge;