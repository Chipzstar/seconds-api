const sendEmail = require('../services/email');
const sendSMS = require('../services/sms');
const express = require('express');
const { AUTHORIZATION_KEY } = require('@seconds-technologies/database_schemas/constants');
const confirmCharge = require('../services/payments');
const { getClientDetails } = require('../helpers');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

router.post('/test/webhook', async(req, res, next) => {
	try {
		console.log("------------------------------------------------")
		console.log("SIGNATURE", req.headers['x-seconds-signature'])
		console.log("------------------------------------------------")
		console.log({status: req.body.status, deliveries: req.body.jobSpecification.deliveries})
		res.status(200).json({success: true})
	} catch (err) {
		console.error(err)
		res.status(400).json({success: false, message: err.message})
	}
})

router.post('/mail', async (req, res) => {
	try {
		const { name, email, subject, text, html, templateId, templateData } = req.body;
		console.table(req.body);
		let options = {
			name,
			email,
			subject,
			...(text && { text: text }),
			...(html && { html: html }),
			...(templateId && { templateId: templateId }),
			...(templateData && { templateData: templateData })
		};
		const response = await sendEmail(options);
		console.log(response);
		res.status(200).json({
			status: 'success',
			message: 'Email sent successfully!'
		});
	} catch (e) {
		console.error(e);
		res.status(400).json({
			status: e.status,
			message: e.message
		});
	}
});

router.post('/sms', async (req, res) => {
	try {
		const { phone, template, alphaSender } = req.body;
		console.table({ phone, template, alphaSender })
		await sendSMS(phone, template, {smsCommission: ""}, true, alphaSender);
		res.status(200).json({
			status: 'success',
			message: 'SMS sent successfully!'
		});
	} catch (e) {
		console.error(e);
		res.status(400).json({
			status: e.status,
			message: e.message
		});
	}
});

router.get('/stripe/report-usage', async (req, res) => {
	try {
		const { deliveryType, quantity } = req.query;
		const apiKey = req.headers[AUTHORIZATION_KEY];
		const { stripeCustomerId, subscriptionId, subscriptionItems } = await getClientDetails(apiKey);
		await confirmCharge({stripeCustomerId, subscriptionId }, subscriptionItems, true, quantity);
		res.status(200).json({ status: 'SUCCESS' });
	} catch (err) {
		console.error(err);
		res.status(400).json({ message: err.message });
	}
});

router.post('/stripe/confirm-payment', async (req, res) => {
	try {
		const { paymentIntentId, paymentMethodId } = req.body;
		const paymentIntent = await stripe.paymentIntents.confirm(paymentIntentId, {
			payment_method: paymentMethodId
		});
		console.log(paymentIntent);
		res.status(200).json(paymentIntent);
	} catch (err) {
		console.error(err);
		res.status(500).json({ message: err.message });
	}
});

module.exports = router;