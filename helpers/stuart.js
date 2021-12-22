const db = require('../models');
const moment = require('moment');
const { STATUS } = require('../constants');
const { JOB_STATUS, DELIVERY_STATUS } = require('../constants/stuart');
const axios = require('axios');
const sendEmail = require('../services/email');
const confirmCharge = require('../services/payments');

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
		console.log(data);
		const jobStatus = data.status;
		const jobId = data.id.toString();
		const {
			id: deliveryId,
			status: deliveryStatus,
			client_reference,
			etaToOrigin,
			etaToDestination,
			driver
		} = data.currentDelivery;
		const {
			firstname,
			lastname,
			phone,
			transportType: { code }
		} = driver;
		// update the status for the current job
		await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': jobId },
			{
				status: translateStuartStatus(jobStatus),
				'driverInformation.name': `${firstname} ${lastname}`,
				'driverInformation.phone': phone,
				'driverInformation.transport': code
			},
			{ new: true }
		);
		const job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': jobId, 'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffEndTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': translateStuartStatus(deliveryStatus)
				}
			},
			{
				new: true
			}
		);
		console.log(job.jobSpecification);
		// add commission charge depending on payment plan
		if (jobStatus === JOB_STATUS.COMPLETED) {
			console.log('****************************************************************');
			console.log('STUART JOB COMPLETEEEEEEE!');
			console.log('****************************************************************');
			let { stripeCustomerId, subscriptionItems } = await db.User.findOne({ _id: job.clientId }, {});
			confirmCharge(
				stripeCustomerId,
				subscriptionItems,
				job.commissionCharge,
				job.paymentIntentId,
				job.jobSpecification.deliveryType,
				job.jobSpecification.deliveries.length
			)
				.then(res => console.log('Charge confirmed:', res))
				.catch(err => console.error(err));
		}
		return jobStatus;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function updateDelivery(data) {
	try {
		const { status: deliveryStatus, id, clientReference, etaToOrigin, etaToDestination } = data;
		const deliveryId = id.toString();
		console.table({ deliveryStatus, deliveryId, clientReference, etaToOrigin, etaToDestination });
		const job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					status: translateStuartStatus(deliveryStatus),
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffEndTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': translateStuartStatus(deliveryStatus)
				}
			},
			{
				new: true
			}
		);
		console.log(job.jobSpecification);
		// check if order status is cancelled and send out email to clients
		if (deliveryStatus === DELIVERY_STATUS.CANCELLED) {
			const user = await db.User.findOne({ _id: job.clientId });
			console.log('User:', !!user);
			let { canceledBy, comment, reasonKey } = data.cancellation;
			console.table(data.cancellation);
			reasonKey = reasonKey === 'pu_closed' ? 'pickup_closed' : reasonKey;
			let reason = comment ? `${reasonKey} | ${comment}` : reasonKey;
			let options = {
				name: `${user.firstname} ${user.lastname}`,
				email: `${user.email}`,
				templateId: 'd-90f8f075032e4d4b90fc595ad084d2a6',
				templateData: {
					client_reference: `${clientReference}`,
					customer: `${job.jobSpecification.deliveries[0].dropoffLocation.firstName} ${job.jobSpecification.deliveries[0].dropoffLocation.lastName}`,
					pickup: `${job.jobSpecification.pickupLocation.fullAddress}`,
					dropoff: `${job.jobSpecification.deliveries[0].dropoffLocation.fullAddress}`,
					reason: `${reason.replace(/[-_]/g, ' ')}`,
					cancelled_by: `${canceledBy}`,
					provider: `stuart`
				}
			};
			await sendEmail(options);
			console.log('CANCELLATION EMAIL SENT!');
		}
		return deliveryStatus;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function updateDriverETA(data) {
	try {
		const {
			job: {
				currentDelivery: { id, etaToDestination, etaToOrigin, status:deliveryStatus, driver }
			}
		} = data;
		console.log([Number(driver.longitude), Number(driver.latitude)])
		const deliveryId = id.toString();
		const job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffEndTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': translateStuartStatus(deliveryStatus),
					'driverInformation.location.type': 'Point',
					'driverInformation.location.coordinates': [Number(driver.longitude), Number(driver.latitude)],
				}
			},
			{
				new: true
			}
		);
		console.log(job)
	} catch (err) {
		console.error(err);
		throw err;
	}
}

module.exports = { updateJob, updateDelivery, updateDriverETA, getStuartAuthToken };