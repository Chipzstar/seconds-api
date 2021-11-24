const db = require('../models');
const moment = require('moment');
const { STATUS } = require('../constants');
const { JOB_STATUS, DELIVERY_STATUS } = require('../constants/stuart');
const { confirmCharge } = require('./index');
const axios = require('axios');

async function getStuartAuthToken() {
	const URL = `${process.env.STUART_ENV}/oauth/token`;
	const params = new URLSearchParams();
	params.append('client_id', process.env.STUART_CLIENT_ID);
	params.append('client_secret', process.env.STUART_CLIENT_SECRET);
	params.append('scope', 'api');
	params.append('grant_type', 'client_credentials');

	const config = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
	const { access_token } = (await axios.post(URL, params, config)).data;
	console.log('NEW STUART TOKEN:', access_token);
	return access_token;
}

/**
 * Maps the current job status of a STUART delivery with the SECONDS delivery status
 * @param value - delivery status returned from the stuart delivery update
 * @returns {string|*}
 */
function translateStuartStatus(value) {
	switch (value) {
		case JOB_STATUS.NEW:
			return STATUS.NEW;
		case DELIVERY_STATUS.PENDING:
			return STATUS.PENDING;
		case JOB_STATUS.PENDING:
			return STATUS.PENDING;
		case JOB_STATUS.IN_PROGRESS:
			return STATUS.DISPATCHING;
		case DELIVERY_STATUS.ALMOST_PICKING:
			return STATUS.DISPATCHING;
		case DELIVERY_STATUS.PICKING:
			return STATUS.DISPATCHING;
		case DELIVERY_STATUS.WAITING_AT_PICKUP:
			return STATUS.DISPATCHING;
		case DELIVERY_STATUS.DELIVERING:
			return STATUS.EN_ROUTE;
		case DELIVERY_STATUS.ALMOST_DELIVERING:
			return STATUS.EN_ROUTE;
		case DELIVERY_STATUS.WAITING_AT_DROPOFF:
			return STATUS.EN_ROUTE;
		case DELIVERY_STATUS.DELIVERED:
			return STATUS.COMPLETED;
		case JOB_STATUS.COMPLETED:
			return STATUS.COMPLETED;
		case DELIVERY_STATUS.CANCELLED:
			return STATUS.CANCELLED;
		case JOB_STATUS.CANCELLED:
			return STATUS.CANCELLED;
		default:
			return value;
	}
}

async function updateJob(data) {
	try {
		const jobStatus = data.status;
		const jobId = data.id;
		const {
			id: deliveryId,
			status: deliveryStatus,
			client_reference,
			etaToOrigin,
			etaToDestination,
			driver
		} = data.currentDelivery;
		console.table({ jobStatus, jobId, client_reference, etaToOrigin, etaToDestination, driver });
		const {
			firstname,
			lastname,
			phone,
			transportType: { code },
		} = driver;
		// update the status for the current job
		await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': jobId },
			{
				'status': translateStuartStatus(jobStatus),
				'driverInformation.name': `${firstname} ${lastname}`,
				'driverInformation.phone': phone,
				'driverInformation.transport': code,
			},
			{ new: true }
		);
		const job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': jobId, 'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffStartTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': translateStuartStatus(deliveryStatus),
				},
			},
			{
				new: true,
			}
		);
		console.log(job.jobSpecification);
		// add commission charge depending on payment plan
		if (jobStatus === JOB_STATUS.COMPLETED) {
			console.log('****************************************************************');
			console.log('STUART JOB COMPLETEEEEEEE!');
			console.log('****************************************************************');
			let { stripeCustomerId, subscriptionItems } = await db.User.findOne({ _id: job.clientId }, {});
			confirmCharge(stripeCustomerId, subscriptionItems, job.commissionCharge, job.jobSpecification.deliveryType, job.jobSpecification.deliveries.length);
		}
		return jobStatus;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function updateDelivery(data) {
	try {
		const { status: deliveryStatus, id: deliveryId, clientReference, etaToOrigin, etaToDestination } = data;
		console.table({ deliveryStatus, deliveryId, clientReference, etaToOrigin, etaToDestination });
		const job = await db.Job.findOneAndUpdate(
			{'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					'status': translateStuartStatus(deliveryStatus),
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffStartTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': translateStuartStatus(deliveryStatus),
				},
			},
			{
				new: true
			}
		);
		console.table(job.jobSpecification.deliveries.find(({ id }) => id === deliveryId));
		return deliveryStatus
	} catch (err) {
		console.error(err);
		throw err;
	}
}

module.exports = { updateJob, updateDelivery, getStuartAuthToken };