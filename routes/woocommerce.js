require('dotenv').config();
const express = require('express');
const db = require('../models');
const router = express.Router();

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		console.table(req.headers);
		console.log(req.body);
		const { status, topic, secret } = req.body;
		// check that the shop domain belongs to a user
		const user = await db.User.findOne({ 'woocommerce.domain': secret });
		console.log('User Found:', !!user);
		if (user) {
			if (topic === 'order.created') {
				console.log('-----------------------------');
				console.log('ORDER:');
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
				message: `Failed to find a user with square shop ${secret}`
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