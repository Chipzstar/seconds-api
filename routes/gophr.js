const express = require('express');
const { JOB_STATUS, WEBHOOK_TYPES } = require('../constants/gophr');
const { STATUS } = require('../constants');
const db = require('../models');
const moment = require('moment');
const sendEmail = require('../services/email');
const confirmCharge = require('../services/payments')
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

function translateGophrStatus(value) {
	switch (value) {
		case JOB_STATUS.NEW:
			return STATUS.NEW;
		case JOB_STATUS.PENDING:
			return STATUS.PENDING;
		case JOB_STATUS.ACCEPTED:
			return STATUS.DISPATCHING;
		case JOB_STATUS.AT_PICKUP:
			return STATUS.DISPATCHING;
		case JOB_STATUS.EN_ROUTE:
			return STATUS.EN_ROUTE;
		case JOB_STATUS.AT_DELIVERY:
			return STATUS.EN_ROUTE;
		case JOB_STATUS.COMPLETED:
			return STATUS.COMPLETED;
		case JOB_STATUS.CANCELLED:
			return STATUS.CANCELLED;
		default:
			return value;
	}
}

async function updateStatus(data) {
	try {
		console.log(data);
		const {
			status: jobStatus,
			external_id: clientReference,
			job_id: JOB_ID,
			finished,
			pickup_eta,
			price_gross,
			delivery_eta,
			courier_name,
			cancellation_reason
		} = data;
		console.log({ jobStatus, JOB_ID, clientReference });
		// update the status for the current job
		await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': JOB_ID },
			{ status: translateGophrStatus(jobStatus) },
			{ new: true }
		);
		let job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': JOB_ID },
			{
				$set: {
					'jobSpecification.pickupStartTime': moment(pickup_eta).toISOString(true),
					'jobSpecification.deliveries.$[].dropoffEndTime': moment(delivery_eta).toISOString(true),
					'driverInformation.name': courier_name,
					'driverInformation.phone': 'N/A',
					'driverInformation.transport': 'N/A',
					'jobSpecification.deliveries.$[].status': translateGophrStatus(jobStatus)
				}
			},
			{
				new: true
			}
		);
		const user = await db.User.findOne({"_id": job.clientId})
		if (!!finished){
			let idempotencyKey = uuidv4();
			const paymentIntent = await stripe.paymentIntents.create(
				{
					amount: Math.round(price_gross * 100),
					customer: user.stripeCustomerId,
					currency: 'GBP',
					setup_future_usage: 'off_session',
					payment_method: user.paymentMethodId,
					payment_method_types: ['card']
				},
				{
					idempotencyKey
				}
			);
			console.log(paymentIntent)
			let job = await db.Job.updateOne({'jobSpecification.id': JOB_ID}, {paymentIntentId: paymentIntent.id}, {new: true})
			console.log("NEW PAYMENT INTENT:", job.paymentIntentId)
		}
		if (jobStatus === JOB_STATUS.CANCELLED) {
			const user = await db.User.findOne({ _id: job.clientId });
			console.log('User:', !!user);
			// check if order status is cancelled and send out email to clients
			let options = {
				name: `${user.firstname} ${user.lastname}`,
				email: `${user.email}`,
				templateId: 'd-90f8f075032e4d4b90fc595ad084d2a6',
				templateData: {
					client_reference: `${clientReference}`,
					customer: `${job.jobSpecification.deliveries[0].dropoffLocation.firstName} ${job.jobSpecification.deliveries[0].dropoffLocation.lastName}`,
					pickup: `${job.jobSpecification.pickupLocation.fullAddress}`,
					dropoff: `${job.jobSpecification.deliveries[0].dropoffLocation.fullAddress}`,
					reason: `${cancellation_reason}`,
					cancelled_by: `operations`,
					provider: `gophr`
				}
			};
			await sendEmail(options);
			console.log('CANCELLATION EMAIL SENT!');
		}
		return { jobStatus, isFinished: Number(finished) };
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function updateETA(data) {
	console.table(data);
	const { job_id: JOB_ID, pickup_eta, delivery_eta } = data;
	// update the status for the current job
	let {
		_doc: { _id, ...job }
	} = await db.Job.findOneAndUpdate(
		{ 'jobSpecification.id': JOB_ID },
		{
			$set: {
				'jobSpecification.pickupStartTime': moment(pickup_eta).toISOString(true),
				'jobSpecification.deliveries.$[].dropoffEndTime': moment(delivery_eta).toISOString(true)
			}
		},
		{
			new: true,
			sanitizeProjection: true
		}
	);
	console.log(job);
	return { pickup_eta, delivery_eta };
}

router.post('/', async (req, res) => {
	try {
		// GOPHR
		const { api_key, webhook_type, job_id } = req.body;
		if (api_key === String(process.env.GOPHR_API_KEY)) {
			if (webhook_type === WEBHOOK_TYPES.STATUS) {
				let { jobStatus, isFinished } = await updateStatus(req.body);
				console.log('--------------------------------');
				console.log('NEW STATUS:', jobStatus);
				console.log('--------------------------------');
				if (isFinished && jobStatus === JOB_STATUS.COMPLETED) {
					let {
						clientId,
						commissionCharge,
						paymentIntentId,
						jobSpecification: { deliveryType, deliveries }
					} = await db.Job.findOne({ 'jobSpecification.id': job_id }, {});
					console.log('****************************************************************');
					console.log('GOPHR DELIVERY COMPLETEEEEEEE!');
					console.log('****************************************************************');
					let { stripeCustomerId, subscriptionItems } = await db.User.findOne({ _id: clientId }, {});
					confirmCharge(
						stripeCustomerId,
						subscriptionItems,
						commissionCharge,
						paymentIntentId,
						deliveryType,
						deliveries.length
					).then(res => console.log("Charge confirmed:", res)).catch(err => console.error(err));
				}
			} else if (webhook_type === WEBHOOK_TYPES.ETA) {
				let jobETA = await updateETA(req.body);
				console.log('--------------------------------');
				console.log('NEW ETA:');
				console.table(jobETA);
				console.log('--------------------------------');
			} else {
				throw new Error(`Unknown webhook type, ${webhook_type}`);
			}
			res.status(200).json({
				success: true,
				message: 'DELIVERY_JOB_UPDATED'
			});
		} else {
			throw new Error('API KEY IS INVALID!');
		}
	} catch (err) {
		console.error(err);
		res.status(200).json({
			success: false,
			message: err.message
		});
	}
});

module.exports = router;