const axios = require('axios');
const { JOB_STATUS, CANCELLATION_REASONS } = require('../../constants/streetStream');
const { STATUS, MAGIC_BELL_CHANNELS } = require('../../constants');
const { ORDER_STATUS } = require('../../constants/hubrise');
const db = require('../../models');
const moment = require('moment');
const sendEmail = require('../../services/email');
const sendSMS = require('../../services/sms');
const sendNotification = require('../../services/notification');
const { sendHubriseStatusUpdate } = require('../../services/hubrise');

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
			return { newStatus: STATUS.PENDING, hubriseStatus: ORDER_STATUS.RECEIVED };
		case JOB_STATUS.JOB_AGREED:
			return { newStatus: STATUS.PENDING, hubriseStatus: ORDER_STATUS.ACCEPTED };
		case JOB_STATUS.IN_PROGRESS:
			return { newStatus: STATUS.DISPATCHING, hubriseStatus: ORDER_STATUS.IN_PREPARATION };
		case JOB_STATUS.ARRIVED_AT_COLLECTION:
			return { newStatus: STATUS.DISPATCHING, hubriseStatus: ORDER_STATUS.AWAITING_SHIPMENT };
		case JOB_STATUS.COLLECTED:
			return { newStatus: STATUS.EN_ROUTE, hubriseStatus: ORDER_STATUS.IN_DELIVERY };
		case JOB_STATUS.ARRIVED_AT_DELIVERY:
			return { newStatus: STATUS.EN_ROUTE, hubriseStatus: ORDER_STATUS.AWAITING_COLLECTION };
		case JOB_STATUS.DELIVERED:
			return { newStatus: STATUS.COMPLETED, hubriseStatus: null };
		case JOB_STATUS.COMPLETED_SUCCESSFULLY:
			return { newStatus: STATUS.COMPLETED, hubriseStatus: ORDER_STATUS.COMPLETED };
		case JOB_STATUS.ADMIN_CANCELLED:
			return { newStatus: STATUS.CANCELLED, hubriseStatus: ORDER_STATUS.CANCELLED };
		case JOB_STATUS.DELIVERY_ATTEMPT_FAILED:
			return { newStatus: STATUS.CANCELLED, hubriseStatus: ORDER_STATUS.DELIVERY_FAILED }
		case JOB_STATUS.NOT_AS_DESCRIBED:
			return { newStatus: STATUS.CANCELLED, hubriseStatus: ORDER_STATUS.DELIVERY_FAILED };
		case JOB_STATUS.NO_RESPONSE:
			return { newStatus: STATUS.CANCELLED, hubriseStatus: ORDER_STATUS.DELIVERY_FAILED };
		default:
			return { newStatus: value, hubriseStatus: null }
	}
}

async function updateJob(data) {
	try {
		console.log(data);
		const { status: jobStatus, jobId } = data;
		// update the status for the current job
		const { newStatus, hubriseStatus } = translateStreetStreamStatus(jobStatus);
		let job = await db.Job.findOne({ 'jobSpecification.id': jobId });
		// check if order is hubrise order, if so attempt to send a status update
		if (job && job['jobSpecification'].hubriseId && hubriseStatus) {
			const hubrise = await db.Hubrise.findOne({clientId: job.clientId})
			sendHubriseStatusUpdate(hubriseStatus, job['jobSpecification'].hubriseId, hubrise)
				.then(() => console.log("Hubrise status update sent!"))
				.catch(err => console.error(err))
		}
		if (newStatus !== job.status) {
			job['jobSpecification'].deliveries[0].status = newStatus;
			job.status = newStatus;
			job.trackingHistory.push({
				timestamp: moment().unix(),
				status: newStatus
			});
			await job.save();
		}
		if (job) {
			const user = await db.User.findOne({ _id: job.clientId });
			let settings = await db.Settings.findOne({ clientId: job.clientId });
			console.log('User:', !!user);
			if (
				jobStatus === JOB_STATUS.ADMIN_CANCELLED ||
				jobStatus === JOB_STATUS.NO_RESPONSE ||
				jobStatus === JOB_STATUS.NOT_AS_DESCRIBED
			) {
				const canSend = settings ? settings['jobAlerts'].cancelled : false;
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
				sendNotification(
					user['_id'],
					'Delivery Cancelled',
					`${jobStatus} - ${CANCELLATION_REASONS[jobStatus].replace(/[-_]/g, ' ')}`,
					MAGIC_BELL_CHANNELS.ORDER_CANCELLED
				).then(() => console.log('notification sent!'));
				sendEmail(options, canSend).then(() => console.log('CANCELLATION EMAIL SENT!'));
			} else if (jobStatus === JOB_STATUS.COLLECTED) {
				const canSend = settings ? settings.sms : false;
				const trackingMessage = `\nTrack the delivery here: ${process.env.TRACKING_BASE_URL}/${job._id}`;
				const template = `Your ${user.company} order has been picked up and the driver is on his way. ${trackingMessage}`;
				sendSMS(
					job['jobSpecification'].deliveries[0].dropoffLocation.phoneNumber,
					template,
					user.subscriptionItems,
					canSend
				).then(() => console.log('SMS sent successfully!'));
			}
			return job;
		}
		throw { status: 'NO_JOB_FOUND', message: `The jobId ${jobId} does not exist` };
	} catch (err) {
		throw err;
	}
}

module.exports = { authStreetStream, updateJob }