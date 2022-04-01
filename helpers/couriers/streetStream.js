const axios = require('axios');
const { JOB_STATUS, CANCELLATION_REASONS } = require('../../constants/streetStream');
const { STATUS } = require('../../constants');
const db = require('../../models');
const moment = require('moment');
const sendEmail = require('../../services/email');
const sendSMS = require('../../services/sms');

async function authStreetStream() {
	const authURL = `${process.env.STREET_STREAM_ENV}/api/tokens`;
	const payload = {
		email: 'secondsdelivery@gmail.com',
		authType: 'CUSTOMER',
		password: process.env.STREET_STREAM_PASSWORD
	};
	let res = (await axios.post(authURL, payload)).headers;
	return res.authorization.split(' ')[1];
}

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

async function updateJob(data) {
	try {
		console.log(data);
		const { status: jobStatus, jobId } = data;
		// update the status for the current job
		const newStatus = translateStreetStreamStatus(jobStatus)
		let job = await db.Job.findOne({ 'jobSpecification.id': jobId });
		if (newStatus !== job.status) {
			job['jobSpecification'].deliveries[0].status = newStatus
			job.status = newStatus
			job.trackingHistory.push({
				timestamp: moment().unix(),
				status: newStatus
			})
			await job.save()
		}
		if (job) {
			const user = await db.User.findOne({ _id: job.clientId });
			let settings = await db.Settings.findOne({ clientId: job.clientId })
			let canSend = settings ? settings.sms : false
			console.log('User:', !!user);
			if (
				jobStatus === JOB_STATUS.ADMIN_CANCELLED ||
				jobStatus === JOB_STATUS.NO_RESPONSE ||
				jobStatus === JOB_STATUS.NOT_AS_DESCRIBED
			) {
				// check if order status is cancelled and send out email to clients
				let options = {
					name: `${user.firstname} ${user.lastname}`,
					email: `${user.email}`,
					templateId: 'd-90f8f075032e4d4b90fc595ad084d2a6',
					templateData: {
						client_reference: `${job['jobSpecification'].deliveries[0].orderReference}`,
						customer: `${job['jobSpecification'].deliveries[0].dropoffLocation.firstName} ${job['jobSpecification'].deliveries[0].dropoffLocation.lastName}`,
						pickup: `${job['jobSpecification'].pickupLocation.fullAddress}`,
						dropoff: `${job['jobSpecification'].deliveries[0].dropoffLocation.fullAddress}`,
						reason: `${jobStatus} - ${CANCELLATION_REASONS[jobStatus].replace(/[-_]/g, ' ')}`,
						cancelled_by: `operations`,
						provider: `street stream`
					}
				};
				await sendEmail(options);
				console.log('CANCELLATION EMAIL SENT!');
			} else if (jobStatus === JOB_STATUS.COLLECTED) {
				const trackingMessage = `\nTrack the delivery here: ${process.env.TRACKING_BASE_URL}/${job._id}`;
				const template = `Your ${user.company} order has been picked up and the driver is on his way. ${trackingMessage}`;
				sendSMS(job['jobSpecification'].deliveries[0].dropoffLocation.phoneNumber, template, user.subscriptionItems, canSend).then(() =>
					console.log('SMS sent successfully!')
				);
			}
			return job;
		}
		throw { status: 'NO_JOB_FOUND', message: `The jobId ${ID} does not exist` };
	} catch (err) {
		throw err;
	}
}

module.exports = { authStreetStream, updateJob, translateStreetStreamStatus,  }