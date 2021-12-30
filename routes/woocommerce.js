require('dotenv').config();
const express = require('express');
const db = require('../models');
const router = express.Router();

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const topic = req.headers['x-wc-webhook-topic']
		const domain = req.headers['x-wc-webhook-source'].endsWith('/') ? req.headers['x-wc-webhook-source'].slice(0, -1): req.headers['x-wc-webhook-source'];
		console.table({topic, domain})
		console.log(req.body.shipping);
		console.log(req.body['shipping_lines'])
		// check that the shop domain belongs to a user
		const user = await db.User.findOne({ 'woocommerce.domain': domain });
		console.log('User Found:', !!user);
		if (user) {
			if (topic === 'order.created') {
				console.log('-----------------------------');
				console.log('ORDER ID:');
				console.table({id: req.body.id, orderKey: req.body['order_key']});
				console.log('-----------------------------');
				res.status(200).json({
					success: true,
					status: 'ORDER_RECEIVED',
					message: 'webhook received'
				});
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