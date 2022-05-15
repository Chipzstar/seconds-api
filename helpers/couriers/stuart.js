const db = require('../../models');
const moment = require('moment');
const { STATUS, MAGIC_BELL_CHANNELS } = require('../../constants');
const { JOB_STATUS, DELIVERY_STATUS } = require('../../constants/stuart');
const { ORDER_STATUS } = require('../../constants/hubrise');
const axios = require('axios');
const sendEmail = require('../../services/email');
const confirmCharge = require('../../services/payments');
const sendSMS = require('../../services/sms');
const sendNotification = require('../../services/notification');
const { sendHubriseStatusUpdate, sendHubriseEtaUpdate } = require('../../services/hubrise');

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
 * @returns {{newStatus: string, hubriseStatus: string}|{newStatus: string, hubriseStatus: null}|{newStatus, hubriseStatus: null}}
 */
function translateStuartStatus(value) {
	switch (value) {
		case JOB_STATUS.NEW:
			return { newStatus: STATUS.NEW, hubriseStatus: ORDER_STATUS.NEW };
		case DELIVERY_STATUS.PENDING:
			return { newStatus: STATUS.NEW, hubriseStatus: ORDER_STATUS.RECEIVED };
		case JOB_STATUS.PENDING:
			return { newStatus: STATUS.NEW, hubriseStatus: ORDER_STATUS.RECEIVED };
		case JOB_STATUS.IN_PROGRESS:
			return { newStatus: STATUS.DISPATCHING, hubriseStatus: ORDER_STATUS.ACCEPTED };
		case DELIVERY_STATUS.ALMOST_PICKING:
			return { newStatus: STATUS.DISPATCHING, hubriseStatus: ORDER_STATUS.IN_PREPARATION };
		case DELIVERY_STATUS.PICKING:
			return { newStatus: STATUS.DISPATCHING, hubriseStatus: ORDER_STATUS.IN_PREPARATION };
		case DELIVERY_STATUS.WAITING_AT_PICKUP:
			return { newStatus: STATUS.DISPATCHING, hubriseStatus: ORDER_STATUS.AWAITING_SHIPMENT };
		case DELIVERY_STATUS.ALMOST_DELIVERING:
			return { newStatus: STATUS.EN_ROUTE, hubriseStatus: ORDER_STATUS.IN_DELIVERY };
		case DELIVERY_STATUS.DELIVERING:
			return { newStatus: STATUS.EN_ROUTE, hubriseStatus: ORDER_STATUS.IN_DELIVERY };
		case DELIVERY_STATUS.WAITING_AT_DROPOFF:
			return { newStatus: STATUS.EN_ROUTE, hubriseStatus: ORDER_STATUS.AWAITING_COLLECTION };
		case DELIVERY_STATUS.DELIVERED:
			return { newStatus: STATUS.COMPLETED, hubriseStatus: null };
		case JOB_STATUS.COMPLETED:
			return { newStatus: STATUS.COMPLETED, hubriseStatus: ORDER_STATUS.COMPLETED };
		case DELIVERY_STATUS.CANCELLED:
			return { newStatus: STATUS.CANCELLED, hubriseStatus: null };
		case JOB_STATUS.CANCELLED:
			return { newStatus: STATUS.CANCELLED, hubriseStatus: ORDER_STATUS.CANCELLED };
		default:
			return { newStatus: value, hubriseStatus: null };
	}
}

/**
 * WEBHOOK - job updates
 * @param data
 * @returns {Promise<Query<any, any, {}, any>>}
 */
async function updateJob(data) {
	try {
		const jobStatus = data.status;
		const jobId = data.id.toString();
		const { id: deliveryId, status: deliveryStatus, etaToOrigin, etaToDestination, driver } = data.currentDelivery;
		const {
			firstname,
			lastname,
			phone,
			transportType: { code }
		} = driver;
		const { newStatus, hubriseStatus } = translateStuartStatus(jobStatus);
		// find the job in the database
		let job = await db.Job.findOne({ 'jobSpecification.id': jobId });
		if (job && job['jobSpecification'].hubriseId && hubriseStatus) {
			const hubrise = await db.Hubrise.findOne({ clientId: job.clientId });
			sendHubriseStatusUpdate(hubriseStatus, job['jobSpecification'].hubriseId, hubrise)
				.then(() => console.log('Hubrise status update sent!'))
				.catch(err => console.error(err));
		}
		if (newStatus !== job.status && jobStatus !== JOB_STATUS.IN_PROGRESS) {
			job.status = newStatus;
			job['trackingHistory'].push({
				timestamp: moment().unix(),
				status: newStatus
			});
			await job.save();
		}
		job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.id': jobId, 'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					'driverInformation.name': `${firstname} ${lastname}`,
					'driverInformation.phone': phone,
					'driverInformation.transport': code,
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffEndTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': translateStuartStatus(deliveryStatus).newStatus
				}
			},
			{
				returnOriginal: false
			}
		);
		// add commission charge depending on payment plan
		if (jobStatus === JOB_STATUS.COMPLETED) {
			console.log('****************************************************************');
			console.log('STUART JOB COMPLETEEEEEEE!');
			console.log('****************************************************************');
			let { company, stripeCustomerId, subscriptionId, subscriptionItems } = await db.User.findOne(
				{ _id: job.clientId },
				{}
			);
			let settings = await db.Settings.findOne({ clientId: job.clientId });
			let canSend = settings ? settings.sms : false;
			confirmCharge(
				{ stripeCustomerId, subscriptionId },
				subscriptionItems,
				{
					commissionCharge: job.commissionCharge,
					deliveryFee: job.selectedConfiguration.deliveryFee,
					deliveryType: job.jobSpecification.deliveryType,
					description: `Order: ${job.jobSpecification.orderNumber}\tRef: ${job.jobSpecification.jobReference}`
				},
				job.jobSpecification.deliveries.length
			)
				.then(res => console.log('Charge confirmed:', res))
				.catch(err => console.error(err));
			const template = `Your ${company} order has been delivered. Thanks for ordering with ${company}`;
			sendSMS(
				job.jobSpecification.deliveries[0].dropoffLocation.phoneNumber,
				template,
				subscriptionItems,
				canSend
			).then(message => console.log(message));
			const title = `Delivery Finished!`;
			const content = `Order ${job.jobSpecification.orderNumber} has been delivered to the customer`;
			sendNotification(job.clientId, title, content, MAGIC_BELL_CHANNELS.ORDER_CREATED).then(() =>
				console.log('notification sent!')
			);
		}
		return job;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

/**
 * WEBHOOK - delivery updates
 * @param data
 * @returns {Promise<Query<any, any, {}, any>>}
 */
async function updateDelivery(data) {
	try {
		const { status: deliveryStatus, id, clientReference, etaToOrigin, etaToDestination } = data;
		const { newStatus, hubriseStatus } = translateStuartStatus(deliveryStatus);
		let job = await db.Job.findOne({ 'jobSpecification.deliveries.id': id.toString() });
		if (job && job['jobSpecification'].hubriseId && hubriseStatus) {
			const hubrise = await db.Hubrise.findOne({ clientId: job.clientId });
			sendHubriseStatusUpdate(hubriseStatus, job['jobSpecification'].hubriseId, hubrise)
				.then(() => console.log('Hubrise status update sent!'))
				.catch(err => console.error(err));
		}
		if (newStatus !== job.status) {
			job.trackingHistory.push({
				timestamp: moment().unix(),
				status: newStatus
			});
			await job.save();
		}
		job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.deliveries.id': id.toString() },
			{
				$set: {
					status: newStatus,
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffEndTime': moment(etaToDestination).toISOString(),
					'jobSpecification.deliveries.$.status': newStatus
				}
			},
			{
				returnOriginal: false
			}
		);
		console.log('------------------------------------------');
		console.log('NEW STATUS:', job.status);
		console.log('------------------------------------------');
		const user = await db.User.findOne({ _id: job.clientId });
		let settings = await db.Settings.findOne({ clientId: job.clientId });
		let canSend = settings ? settings.sms : false;
		// check if the delivery status is "en-route"
		if (deliveryStatus === DELIVERY_STATUS.DELIVERING) {
			const trackingMessage = `\nTrack the delivery here: ${process.env.TRACKING_BASE_URL}/${job._id}`;
			const template = `Your ${user.company} order has been picked up and the driver is on his way. ${trackingMessage}`;
			sendSMS(
				job.jobSpecification.deliveries[0].dropoffLocation.phoneNumber,
				template,
				user.subscriptionItems,
				canSend
			).then(message => console.log(message));
		}
		// check if order status is cancelled and send out email to clients
		if (deliveryStatus === DELIVERY_STATUS.CANCELLED) {
			console.log('User:', !!user);
			let { canceledBy, comment, reasonKey } = data.cancellation;
			console.table(data.cancellation);
			const settings = await db.Settings.findOne({ clientId: job.clientId });
			let canSend = settings && settings['jobAlerts'].cancelled;
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
			sendNotification(
				user.clientId,
				'Delivery Cancelled',
				reason.replace(/[-_]/g, ' '),
				MAGIC_BELL_CHANNELS.ORDER_CANCELLED
			).then(() => console.log('notification sent!'));
			sendEmail(options, canSend).then(() => console.log('CANCELLATION EMAIL SENT!'));
		}
		return job;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

/**
 * WEBHOOK - ETA updates
 * @param data
 * @returns {Promise<Query<any, any, {}, any>>}
 */
async function updateDriverETA(data) {
	try {
		const {
			job: {
				currentDelivery: { id, etaToDestination, etaToOrigin, driver }
			}
		} = data;
		const deliveryId = id.toString();
		if (driver.latitude && driver.longitude) {
			await db.Job.findOneAndUpdate(
				{ 'jobSpecification.id': deliveryId },
				{
					$set: {
						'driverInformation.location': {
							type: 'Point',
							coordinates: [Number(driver.longitude), Number(driver.latitude)]
						}
					}
				},
				{ new: true }
			);
		}
		const job = await db.Job.findOneAndUpdate(
			{ 'jobSpecification.deliveries.id': deliveryId },
			{
				$set: {
					'jobSpecification.pickupStartTime': moment(etaToOrigin).toISOString(),
					'jobSpecification.deliveries.$.dropoffEndTime': moment(etaToDestination).toISOString(),
					'driverInformation.location': {
						type: 'Point',
						coordinates: [Number(driver.longitude), Number(driver.latitude)]
					}
				}
			},
			{
				returnOriginal: false
			}
		);
		// check if job contains a hubrise order, if so send an eta update to hubrise
		if (job && job['jobSpecification'].hubriseId && etaToDestination) {
			const hubrise = await db.Hubrise.findOne({ clientId: job.clientId });
			const deliveryInfo = {
				pickupTime: moment(etaToOrigin).toISOString(true),
				trackingUrl: job['jobSpecification'].deliveries[0].trackingURL,
				driverName: job['driverInformation'].name,
				driverPhone: job['driverInformation'].phone
			};
			sendHubriseEtaUpdate(
				moment(etaToDestination).toISOString(true),
				deliveryInfo,
				job['jobSpecification'].hubriseId,
				hubrise
			)
				.then(message => console.log(message))
				.catch(err => console.error(err));
		}
		return job;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

module.exports = { updateJob, updateDelivery, updateDriverETA, getStuartAuthToken };