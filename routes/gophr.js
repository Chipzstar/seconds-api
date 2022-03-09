const express = require('express');
const { JOB_STATUS, WEBHOOK_TYPES } = require('../constants/gophr');
const { STATUS } = require('../constants');
const db = require('../models');
const moment = require('moment');
const sendEmail = require('../services/email');
const confirmCharge = require('../services/payments');
const sendSMS = require('../services/sms');
const { v4: uuidv4 } = require('uuid');
const { sendWebhookUpdate } = require('../helpers');
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
		console.table(data);
		const {
			status: jobStatus,
			external_id: clientReference,
			job_id: JOB_ID,
			pickup_eta,
			delivery_eta,
			courier_name,
			cancellation_reason
		} = data;
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
					'driverInformation.phone': 'Open tracking URL to see contact number',
					'jobSpecification.deliveries.$[].status': translateGophrStatus(jobStatus)
				}
			},
			{
				new: true
			}
		);
		const user = await db.User.findOne({ _id: job.clientId });
		// check if job is en-route, send en-route SMS
		if (jobStatus === JOB_STATUS.EN_ROUTE) {
			const trackingMessage = job.jobSpecification.deliveries[0].trackingURL
				? `\nTrack the delivery here: ${job.jobSpecification.deliveries[0].trackingURL}`
				: '';
			const template = `Your ${user.company} order has been picked up and the driver is on his way. ${trackingMessage}`;
			sendSMS(job.jobSpecification.deliveries[0].dropoffLocation.phoneNumber, template).then(() =>
				console.log('SMS sent successfully!')
			);
		}
		if (jobStatus === JOB_STATUS.CANCELLED) {
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
		return job;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function updateETA(data) {
	console.table(data);
	const { job_id: JOB_ID, pickup_eta, delivery_eta, courier_location_lat, courier_location_lng } = data;
	// check if lat and lng value, then update the driver location in job db
	if (courier_location_lat && courier_location_lng) {
		await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': JOB_ID },
			{
				$set: {
					'driverInformation.location': {
						type: 'Point',
						coordinates: [Number(courier_location_lng), Number(courier_location_lat)]
					}
				}
			},
			{ new: true }
		);
	}
	// update the status for the current job
	let job = await db.Job.findOneAndUpdate(
		{ 'jobSpecification.id': JOB_ID },
		{
			$set: {
				'jobSpecification.pickupStartTime': moment(pickup_eta).toISOString(true),
				'jobSpecification.deliveries.$[].dropoffEndTime': moment(delivery_eta).toISOString(true)
			}
		},
		{
			new: true
		}
	);
	return job;
}

router.post('/', async (req, res) => {
	try {
		// GOPHR
		const { api_key, webhook_type, job_id } = req.body;
		let job = null;
		if (api_key === String(process.env.GOPHR_API_KEY)) {
			if (webhook_type === WEBHOOK_TYPES.STATUS) {
				// update the status of the job in db and return it
				job = await updateStatus(req.body);
				// define the topic name for the webhook
				let topic = [JOB_STATUS.PENDING, JOB_STATUS.ACCEPTED].includes(req.body.status)
					? 'job.create'
					: 'job.update';
				sendWebhookUpdate(job, topic).then(() => console.log('STATUS UPDATE DELIVERED TO CLIENT'));
				if (Number(req.body.finished) && req.body.status === JOB_STATUS.COMPLETED) {
					let {
						clientId,
						commissionCharge,
						jobSpecification: { jobReference, orderNumber, deliveryType, deliveries },
						selectedConfiguration: { deliveryFee }
					} = await db.Job.findOne({ 'jobSpecification.id': job_id }, {});
					console.log('****************************************************************');
					console.log('GOPHR DELIVERY COMPLETEEEEEEE!');
					console.log('****************************************************************');
					let { company, stripeCustomerId, subscriptionId, subscriptionItems } = await db.User.findOne({ _id: clientId }, {});
					confirmCharge(
						{ stripeCustomerId, subscriptionId },
						subscriptionItems,
						{
							commissionCharge,
							deliveryFee,
							deliveryType,
							description: `Order: ${orderNumber}\tRef: ${jobReference}`
						},
						deliveries.length
					)
						.then(res => console.log('Charge confirmed:', res))
						.catch(err => console.error(err));
					const template = `Your ${company} order has been delivered. Thanks for ordering with ${company}!`;
					sendSMS(job.jobSpecification.deliveries[0].dropoffLocation.phoneNumber, template).then(() =>
						console.log('SMS sent successfully!')
					);
				}
			} else if (webhook_type === WEBHOOK_TYPES.ETA) {
				job = await updateETA(req.body);
				sendWebhookUpdate(job, 'delivery.update').then(() => console.log('ETA UPDATE DELIVERED TO CLIENT'));
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
