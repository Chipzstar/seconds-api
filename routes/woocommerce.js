require('dotenv').config();
const express = require('express');
const db = require('../models');
const { DELIVERY_METHODS } = require('../constants/shopify');
const axios = require('axios');
const sendEmail = require('../services/email');
const router = express.Router();

async function createNewJob(order, user) {
	try {
		console.log(order.line_items);
		// iterate through each product and record its weight
		const productWeights = await Promise.all(
			order['line_items'].map(async ({ product_id }) => {
				const endpoint = `/wp-json/wc/v3/products/${product_id}`;
				const URL = `${user.woocommerce.domain}${endpoint}`;
				console.log(URL);
				let response = (
					await axios.get(URL, {
						auth: {
							username: user.woocommerce.consumerKey,
							password: user.woocommerce.consumerSecret
						}
					})
				).data;
				console.log(response);
				return response.weight;
			})
		);
		console.log(productWeights);
		return true;
	} catch (err) {
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed Shopify order #${order.id}`,
			text: `Job could not be created. Reason: ${err.message}`,
			html: `<p>Job could not be created. Reason: ${err.message}</p>`
		});
		console.error(err);
		return err;
	}
}

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const topic = req.headers['x-wc-webhook-topic'];
		const domain = req.headers['x-wc-webhook-source'].endsWith('/')
			? req.headers['x-wc-webhook-source'].slice(0, -1)
			: req.headers['x-wc-webhook-source'];
		console.table({ topic, domain });
		console.log(req.body.shipping);
		console.log(req.body['shipping_lines']);
		// check that the shop domain belongs to a user
		const user = await db.User.findOne({ 'woocommerce.domain': domain });
		console.log('User Found:', !!user);
		if (user) {
			if (topic === 'order.created') {
				console.log('-----------------------------');
				console.log('ORDER ID:');
				console.table({ id: req.body.id, orderKey: req.body['order_key'] });
				console.log('-----------------------------');
				// CHECK if the incoming delivery is a local delivery
				const isLocalDelivery = req.body['shipping_lines'][0]['method_title'] === DELIVERY_METHODS.LOCAL;
				const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
				console.log('isLocalDelivery:', isLocalDelivery);
				if (isLocalDelivery) {
					if (isSubscribed) {
						createNewJob(req.body, user);
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
				message: `Failed to find a user with square shop ${domain}`
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
