const { DELIVERY_TYPES } = require('../constants');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
			standardCommission,
			multiDropCommission
		});
		// Create invoice item to be added to the customer's next upcoming invoice
		const invoiceItem = await stripe.invoiceItems.create({
			customer: stripeCustomerId,
			amount: Math.round(jobInfo.deliveryFee * 100),
			currency: "GBP",
			description: jobInfo.description,
			subscription: subscriptionId
		});
		console.log('----------------------------------------------');
		console.log('Delivery Fee added to next invoice!');
		console.log(invoiceItem);
		console.log('----------------------------------------------');

		console.log('*********************************');
		if (standardCommission && jobInfo.commissionCharge) {
			let usageRecord;
			if (jobInfo.deliveryType === DELIVERY_TYPES.MULTI_DROP.name) {
				usageRecord = await stripe.subscriptionItems.createUsageRecord(multiDropCommission, {
					quantity,
					action: 'increment',
					timestamp: Math.ceil(Date.now() / 1000)
				});
			} else {
				usageRecord = await stripe.subscriptionItems.createUsageRecord(standardCommission, {
					quantity,
					action: 'increment',
					timestamp: Math.ceil(Date.now() / 1000)
				});
			}
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