require('dotenv').config();
const express = require('express');
const { STATUS } = require('../constants');
const { JOB_STATUS } = require('../constants/streetStream');
const db = require('../models');
const { confirmCharge } = require('../helpers');
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
		const { status: STATUS, jobId: ID } = data;
		console.log({ STATUS, ID });
		// update the status for the current job
		let job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': ID },
			{
				'status': translateStreetStreamStatus(STATUS),
				'jobSpecification.deliveries.$[].status': translateStreetStreamStatus(STATUS),
			},
			{ new: true }
		);
		if (job) {
			console.log(job);
			return job.status;
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
			let { clientId, commissionCharge } = await db.Job.findOne({ 'jobSpecification.id': req.body.jobId }, {});
			console.log('****************************************************************');
			console.log('STREET-STREAM DELIVERY COMPLETEEEEEEE!');
			console.log('****************************************************************');
			let { stripeCustomerId, stripeCommissionId } = await db.User.findOne({ _id: clientId }, {});
			confirmCharge(stripeCustomerId, stripeCommissionId, commissionCharge);
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