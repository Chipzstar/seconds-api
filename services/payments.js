const { DELIVERY_TYPES } = require('../constants');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const confirmCharge = async (
	customerId,
	{ standardMonthly, standardCommission, multiDropCommission },
	canCharge,
	paymentIntentId,
	deliveryType,
	quantity = 1
) => {
	try {
		console.log('*********************************');
		console.table({
			customerId,
			standardMonthly,
			standardCommission,
			multiDropCommission,
			canCharge,
			paymentIntentId,
			deliveryType
		});
		console.log('*********************************');
		if (paymentIntentId) {
			const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
				setup_future_usage: 'off_session'
			});
			console.log('----------------------------------------------');
			console.log('Delivery Fee Paid Successfully!');
			console.log(paymentIntent);
			console.log('----------------------------------------------');
		}
		console.log('*********************************');
		if (standardCommission && canCharge) {
			let usageRecord;
			if (deliveryType === DELIVERY_TYPES.MULTI_DROP.name) {
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