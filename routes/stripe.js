const express = require("express");
const {handleActiveSubscription, handleCanceledSubscription} = require("../helpers");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

router.post('/webhook', express.raw({type: 'application/json'}), (request, response) => {
	let event = request.body;
	// Replace this endpoint secret with your endpoint's unique secret
	// If you are testing with the CLI, find the secret by running 'stripe listen'
	// If you are using an endpoint defined with the API or dashboard, look in your webhook settings
	// at https://dashboard.stripe.com/webhooks
	const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_XwyhyYVeQUp3PP0jjbanP9hKNpbZ878r'
	// Only verify the event if you have an endpoint secret defined.
	// Otherwise use the basic event deserialized with JSON.parse
	if (endpointSecret) {
		// Get the signature sent by Stripe
		const signature = request.headers['stripe-signature'];
		try {
			event = stripe.webhooks.constructEvent(
				request.body,
				signature,
				endpointSecret
			);
			console.log("✅  Success Webhook verified!")
		} catch (err) {
			console.log(`⚠  Webhook signature verification failed.`, err.message);
			return response.sendStatus(400);
		}
	}
	let subscription;
	let status;
	// Handle the event
	switch (event.type) {
		case 'customer.subscription.trial_will_end':
			subscription = event.data.object;
			status = subscription.status;
			console.log(`Subscription status is ${status}.`);
			// Then define and call a method to handle the subscription trial ending.
			// handleSubscriptionTrialEnding(subscription);
			break;
		case 'customer.subscription.deleted':
			subscription = event.data.object;
			status = subscription.status;
			// Then define and call a method to handle the subscription deleted.
			handleCanceledSubscription(subscription)
				.then(res => console.log(res))
				.catch(err => console.error(err))
			break;
		case 'customer.subscription.created':
			subscription = event.data.object;
			status = subscription.status;
			console.log(`Subscription status is ${status}.`);
			// Then define and call a method to handle the subscription created.
			break;
		case 'customer.subscription.updated':
			console.log("CUSTOMER_SUBSCRIPTION_UPDATED")
			subscription = event.data.object;
			status = subscription.status;
			handleActiveSubscription(subscription)
				.then(res => console.log(res))
				.catch(err => console.error(err))
			break;
		case 'invoice.paid':
			console.log("INVOICE_PAID")
			break;
		case 'payment_intent.succeeded':
			console.log("PAYMENT_INTENT_SUCCEEDED")
			break;
		case 'payment_intent.created':
			console.log("PAYMENT_INTENT_CREATED")
			break;
		case 'invoice.payment_succeeded':
			console.log("INVOICE_PAYMENT_SUCCEEDED")
			break;
		default:
			// Unexpected event type
			console.log(`Unhandled event type ${event.type}.`);
	}
	// Return a 200 response to acknowledge receipt of the event
	response.status(200).send();
});

module.exports = router;