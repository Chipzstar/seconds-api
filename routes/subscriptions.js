require("dotenv").config();
const express = require("express");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require("../models");
const moment = require("moment");
const {SUBSCRIPTION_DOMAIN} = require('../constants/index');
const router = express.Router();

router.post("/setup-subscription", async (req, res) => {
	const { email, stripeCustomerId } = req.body;
	//const key = uuidv4()
	try {
		const subscription = await stripe.subscriptions.create({
			customer: stripeCustomerId,
			items: [
				{price: process.env.STRIPE_SUBSCRIPTION_ID},
			],
		});
		console.log("SUBSCRIPTION:", subscription)
		//attach the subscription id to the user
		const updatedUser = db.User.findOneAndUpdate({"email": email}, {"stripeSubscriptionId": subscription.id}, {new: true})
		console.log(updatedUser)
		res.status(200).json(subscription)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/fetch-stripe-subscription", async (req, res) => {
	const {stripeSubscriptionId} = req.body;
	console.log(stripeSubscriptionId)
	try {
		const subscription = await stripe.subscriptions.retrieve(
			stripeSubscriptionId
		);
		console.log(subscription)
		res.status(200).json(subscription)
	} catch (e) {
		console.error(e)
		res.status(400).json({
			error: {...e}
		})
	}
})

router.post("/cancel-subscription", async (req, res) => {
	const {email} = req.body;
	// get the subscription id from the customer
	const {stripeSubscriptionId} = db.User.findOne({"email": email}, {})
	const deleted = await stripe.subscriptions.del(
		stripeSubscriptionId
	);
	res.status(200).json({
		stripeSubscriptionId: deleted.id,
		cancelledAt: moment(deleted.canceled_at).toISOString(),
		status: deleted.status
	})
})

router.post('/create-checkout-session', async (req, res) => {
	console.log("REQUEST:", req.body)
	const { lookup_key, stripe_customer_id } = req.body;
	console.log("--------------------------------------")
	console.log("LOOKUP KEY:", lookup_key)
	console.log("--------------------------------------")
	const prices = await stripe.prices.list({
		lookup_keys: [lookup_key],
		expand: ['data.product'],
	});
	const session = await stripe.checkout.sessions.create({
		customer: stripe_customer_id,
		billing_address_collection: 'auto',
		payment_method_types: ['card'],
		line_items: [
			{
				price: prices.data[0].id,
				// For metered billing, do not pass quantity
				quantity: 1,
			},
		],
		mode: 'subscription',
		success_url: `${String(process.env.SUBSCRIPTION_DOMAIN) || SUBSCRIPTION_DOMAIN}/payment?success=true&session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${String(process.env.SUBSCRIPTION_DOMAIN) || SUBSCRIPTION_DOMAIN}/payment?canceled=true`,
	});
	res.redirect(303, session.url)
});

router.post('/create-portal-session', async (req, res) => {
	const { stripe_customer_id } = req.body;
	console.log("--------------------------------------")
	console.log("CUSTOMER ID:", stripe_customer_id)
	console.log("--------------------------------------")
	// managing their billing with the portal.
	const portalSession = await stripe.billingPortal.sessions.create({
		customer: stripe_customer_id,
		// This is the url to which the customer will be redirected when they are done
		return_url: String(process.env.SUBSCRIPTION_DOMAIN) || SUBSCRIPTION_DOMAIN,
	});
	res.redirect(303, portalSession.url);
});

module.exports = router;