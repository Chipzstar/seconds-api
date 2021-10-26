require('dotenv').config();
const express = require('express');
const db = require('../models');
const router = express.Router();

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const topic = req.headers['x-shopify-topic'];
		const shop = req.headers['x-shopify-shop-domain'];
		console.table({ topic, shop });
		if (topic === 'orders/create') {
			console.log('-----------------------------');
			console.log("ORDER ID:")
			console.log(req.body.id);
			console.log('-----------------------------');
			const user = await db.User.findOne({ 'shopify.domain': shop });
			console.log(user);
			user
				? res.status(200).json({
						status: 'SUCCESS',
						message: 'webhook received',
				  })
				: res.status(404).json({
						status: 'USER_NOT_FOUND',
						message: `Failed to find a user with shopify domain ${shop}`,
				  });
		} else {
			res.status(400).json({
				status: 'UNKNOWN_TOPIC',
				message: `Webhook topic ${topic} is not recognised`,
			});
		}
	} catch (err) {
		console.error(err);
		res.status(500).json({
			error: { ...err },
		});
	}
});

module.exports = router;
