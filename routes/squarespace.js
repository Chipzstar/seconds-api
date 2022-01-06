require('dotenv').config();
const express = require('express');
const db = require('../models');
const { DELIVERY_METHODS } = require('../constants/shopify');
const axios = require('axios');
const sendEmail = require('../services/email');
const { convertWeightToVehicleCode, geocodeAddress, genOrderReference, createEcommerceJob } = require('../helpers');
const moment = require('moment');
const router = express.Router();

async function generatePayload(){
	try {
	    return true
	} catch (err) {
	    console.error(err)
	}
}

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop site Id
		const { topic, websiteId, data } = req.body;
		console.table({ topic, websiteId });
		// check that the shop domain belongs to a user
		const user = await db.User.findOne({ 'squarespace.siteId': websiteId });
		console.log('User Found:', !!user);
		if (user) {
			console.log(data)
			if (topic === 'order.create') {
				console.log('-----------------------------');
				console.log('ORDER ID:');
				console.log(data['orderId'])
				console.log('-----------------------------');
				// CHECK if the incoming delivery is a local delivery
				const isLocalDelivery = req.body['shipping_lines'][0]['method_title'] === DELIVERY_METHODS.LOCAL;
				const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
				console.log('isLocalDelivery:', isLocalDelivery);
				if (isLocalDelivery) {
					if (isSubscribed) {
						generatePayload(req.body, user).then(payload => {
							const ids = { shopifyId: null, woocommerceId: req.body['order_key']}
							createEcommerceJob("WooCommerce", req.body['order_key'], payload, ids, user)
						}).catch(err => console.error(err));
						res.status(200).json({
							success: true,
							status: 'ORDER_RECEIVED',
							message: 'webhook received'
						});
					} else {
						console.error('No subscription detected!');
						return res.status(200).json({
							success: false,
							status: 'NO_SUBSCRIPTION',
							message:
								'We cannot carry out orders without a subscription. Please subscribe to one of our business plans!'
						});
					}
				} else {
					res.status(200).json({
						success: false,
						status: 'NON_LOCAL_DELIVERY',
						message: 'Seconds can only fulfill orders using the local delivery method'
					});
				}
			} else {
				console.log('Unknown topic');
				res.status(200).json({
					success: false,
					status: 'UNKNOWN_TOPIC',
					message: `Webhook topic ${topic} is not recognised`
				});
			}
		} else {
			res.status(200).json({
				success: false,
				status: 'USER_NOT_FOUND',
				message: `Failed to find a user with squarespace siteId ${websiteId}`
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