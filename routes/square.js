require('dotenv').config();
const express = require('express');
const db = require('../models');
const router = express.Router();
const {
	genJobReference,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob,
	getVehicleSpecs,
	calculateJobDistance,
	checkDeliveryHours,
	setNextDayDeliveryTime,
	genOrderReference,
	sendNewJobEmails
} = require('../helpers');
const { DELIVERY_METHODS } = require('../constants/shopify');

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const environment = req.headers['square-environment'];
		const squareVersion = req.headers['square-version'];
		const { merchant_id, type, data } = req.body;
		console.table({ environment, squareVersion, merchant_id, type });
		if (type === 'order.created') {
			console.log('-----------------------------');
			console.log('ORDER ID:');
			console.log(data.id);
			console.log('-----------------------------');
			// check that the shop domain belongs to a user
			const user = await db.User.findOne({ 'square.shopId': merchant_id });
			console.log('User Found:', !!user);
			if (user) {
				console.log(user)
				res.status(200).json({
					success: true,
					status: 'DELIVERY_JOB_CREATED',
					message: 'webhook received'
				});
			} else {
				res.status(200).json({
					success: false,
					status: 'USER_NOT_FOUND',
					message: `Failed to find a user with square shop ${merchant_id}`
				});
			}
		} else {
			res.status(200).json({
				success: false,
				status: 'UNKNOWN_TOPIC',
				message: `Webhook type ${type} is not recognised`
			});
		}
	} catch (err) {
		console.error(err);
		res.status(200).json({
			success: false,
			STATUS: 'INTERNAL_SERVER_ERROR',
			message: err.message
		});
	}
});

module.exports = router;
