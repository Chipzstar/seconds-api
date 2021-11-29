require('dotenv').config();
const express = require('express');
const { STATUS } = require('../constants');
const { JOB_STATUS, CANCELLATION_REASONS } = require('../constants/streetStream');
const db = require('../models');
const { confirmCharge } = require('../helpers');
const sendEmail = require('../services/email');
const router = express.Router();

function translateStreetStreamStatus(value) {
	switch (value) {
		case JOB_STATUS.OFFERS_RECEIVED:
			return STATUS.PENDING;
		case JOB_STATUS.JOB_AGREED:
			return STATUS.DISPATCHING;
		case JOB_STATUS.IN_PROGRESS:
			return STATUS.DISPATCHING;
		case JOB_STATUS.ARRIVED_AT_COLLECTION:
			return STATUS.DISPATCHING;
		case JOB_STATUS.COLLECTED:
			return STATUS.EN_ROUTE;
		case JOB_STATUS.ARRIVED_AT_DELIVERY:
			return STATUS.EN_ROUTE;
		case JOB_STATUS.DELIVERED:
			return STATUS.COMPLETED;
		case JOB_STATUS.COMPLETED_SUCCESSFULLY:
			return STATUS.COMPLETED;
		case JOB_STATUS.ADMIN_CANCELLED:
			return STATUS.CANCELLED;
		case JOB_STATUS.DELIVERY_ATTEMPT_FAILED:
			return STATUS.CANCELLED;
		case JOB_STATUS.NOT_AS_DESCRIBED:
			return STATUS.CANCELLED;
		case JOB_STATUS.NO_RESPONSE:
			return STATUS.CANCELLED;
		default:
			return STATUS.NEW;
	}
}

async function update(data) {
	try {
		console.log(data);
		const { status: jobStatus, jobId: ID } = data;
		console.log({ jobStatus, ID });
		// update the status for the current job
		let job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': ID },
			{
				'status': translateStreetStreamStatus(jobStatus),
				'jobSpecification.deliveries.$[].status': translateStreetStreamStatus(jobStatus),
			},
			{ new: true }
		);
		if (job) {
			console.log(job);
			if (jobStatus === JOB_STATUS.ADMIN_CANCELLED || jobStatus === JOB_STATUS.NO_RESPONSE || jobStatus === JOB_STATUS.NOT_AS_DESCRIBED) {
				const user = await db.User.findOne({ _id: job.clientId });
				console.log('User:', !!user);
				// check if order status is cancelled and send out email to clients
				let options = {
					name: `${user.firstname} ${user.lastname}`,
					email: `${user.email}`,
					templateId: 'd-90f8f075032e4d4b90fc595ad084d2a6',
					templateData: {
						client_reference: `${job.jobSpecification.deliveries[0].orderReference}`,
						customer: `${job.jobSpecification.deliveries[0].dropoffLocation.firstName} ${job.jobSpecification.deliveries[0].dropoffLocation.lastName}`,
						pickup: `${job.jobSpecification.pickupLocation.fullAddress}`,
						dropoff: `${job.jobSpecification.deliveries[0].dropoffLocation.fullAddress}`,
						reason: `${jobStatus} - ${CANCELLATION_REASONS[jobStatus].replace(/[-_]/g, ' ')}`,
						cancelled_by: `operations`,
						provider: `street stream`
					}
				};
				await sendEmail(options);
				console.log('CANCELLATION EMAIL SENT!');
			}
			return jobStatus;
		}
		throw { status: 'NO_JOB_FOUND', message: `The jobId ${ID} does not exist` };
	} catch (err) {
		throw err;
	}
}

router.post('/', async (req, res) => {
	try {
		let jobStatus = await update(req.body);
		if (jobStatus === JOB_STATUS.COMPLETED_SUCCESSFULLY) {
			let { clientId, commissionCharge, jobSpecification: { deliveryType, deliveries } } = await db.Job.findOne({ 'jobSpecification.id': req.body.jobId }, {});
			console.log('****************************************************************');
			console.log('STREET-STREAM DELIVERY COMPLETEEEEEEE!');
			console.log('****************************************************************');
			let { stripeCustomerId, subscriptionItems } = await db.User.findOne({ _id: clientId }, {});
			confirmCharge(stripeCustomerId, subscriptionItems, commissionCharge, deliveryType, deliveries.length);
		}
		res.status(200).send({
			success: true,
			status: 'NEW_JOB_STATUS',
			message: `Job status is now ${jobStatus}`,
		});
	} catch (err) {
		console.error(err);
		res.status(200).json({
			success: false,
			status: err.status,
			message: err.message,
		});
	}
});

module.exports = router;