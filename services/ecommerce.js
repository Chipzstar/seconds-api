const {
	genJobReference,
	getVehicleSpecs,
	calculateJobDistance,
	checkPickupHours,
	setNextDayDeliveryTime,
	findAvailableDriver,
	genDeliveryId,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob
} = require('../helpers');

const {
	DELIVERY_TYPES,
	COMMISSION,
	BATCH_OPTIONS,
	DISPATCH_OPTIONS,
	VEHICLE_CODES_MAP,
	STATUS,
	PROVIDERS,
	DISPATCH_MODES
} = require('@seconds-technologies/database_schemas/constants');
const orderId = require('order-id')(process.env.UID_SECRET_KEY);

const db = require('../models');
const moment = require('moment');
const sendSMS = require('./sms');
const sendEmail = require('./email');
const { finaliseJob, dailyBatchOrder, incrementalBatchOrder } = require('../helpers');
const sendNotification = require('./notification');

async function createEcommerceJob(type, id, payload, ecommerceIds, user, settings, domain) {
	try {
		let job;
		let commissionCharge = false;
		const clientRefNumber = genJobReference();
		const { _id: clientId, selectionStrategy, deliveryHours } = user;
		// get specifications for the vehicle
		let vehicleSpecs = getVehicleSpecs(payload.vehicleType);
		console.log('=====================================');
		console.log('VEHICLE SPECS');
		console.log(vehicleSpecs);
		console.log('=====================================');
		// calculate job distance
		const jobDistance = await calculateJobDistance(
			payload.pickupAddress,
			payload.drops[0].dropoffAddress,
			vehicleSpecs.travelMode
		);
		// check delivery hours
		let canDeliver = checkPickupHours(payload.packagePickupStartTime, deliveryHours);
		if (!canDeliver) {
			// if can't deliver, fetch the next available delivery date
			const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(
				payload.packagePickupStartTime,
				deliveryHours
			);
			payload.packageDeliveryType = DELIVERY_TYPES.NEXT_DAY.name;
			payload.packagePickupStartTime = nextDayPickup;
			payload.drops[0].packageDropoffEndTime = nextDayDropoff;
		}
		console.log('-----------------------------------------------------------------');
		console.log(payload.packagePickupStartTime);
		console.log('-----------------------------------------------------------------');
		// check the payment plan and lookup the associated commission fee
		let { fee, limit } = COMMISSION[user.subscriptionPlan.toUpperCase()];
		console.log('--------------------------------');
		console.log('COMMISSION FEE:', fee);
		// check whether the client number of orders has exceeded the limit
		const numOrders = await db.Job.where({ clientId, status: 'COMPLETED' }).countDocuments();
		console.log('NUM COMPLETED ORDERS:', numOrders);
		console.log('--------------------------------');
		// if the order limit is exceeded, mark the job with a commission fee charge
		if (numOrders >= limit) commissionCharge = true;
		/*---------------------------------------------------------------------------------------*/
		// AUTO-BATCHING LOGIC
		// if autoBatching is enabled,
		// check the defaultBatchMode [DAILY | INCREMENTAL]
		if (settings && settings.autoBatch.enabled) {
			// if defaultBatchMode = DAILY,
			if (settings.defaultBatchMode === BATCH_OPTIONS.DAILY) {
				const job = dailyBatchOrder(payload, settings, deliveryHours, clientRefNumber, vehicleSpecs);
				return await finaliseJob(user, job, clientId, commissionCharge, null, settings, settings.sms);
			} else {
				const job = incrementalBatchOrder(payload, settings, deliveryHours, clientRefNumber, vehicleSpecs);
				return await finaliseJob(user, job, clientId, commissionCharge, null, settings, settings.sms);
			}
			// NON-AUTO-BATCHING LOGIC
			// check user default dispatch settings of the user
			// if default dispatcher = DRIVER, attempt to assign the job to a driver
		} else if (settings && settings.defaultDispatch === DISPATCH_OPTIONS.DRIVER) {
			// if autoDispatch is enabled, find an available driver
			if (settings.autoDispatch.enabled) {
				console.log('*****************************************');
				console.log('AUTO DISPATCH ENABLED!');
				console.log('*****************************************');
				const driver = await findAvailableDriver(user, settings);
				console.log(driver);
				if (driver) {
					job = {
						createdAt: moment().format(),
						driverInformation: {
							id: `${driver['_id']}`,
							name: `${driver.firstname} ${driver.lastname}`,
							phone: driver.phone,
							transport: VEHICLE_CODES_MAP[driver.vehicle].name
						},
						jobSpecification: {
							id: genDeliveryId(),
							jobReference: clientRefNumber,
							orderNumber: orderId.generate(),
							deliveryType: payload.packageDeliveryType,
							pickupStartTime: payload.packagePickupStartTime,
							pickupEndTime: payload.packagePickupEndTime,
							pickupLocation: {
								fullAddress: payload.pickupAddress,
								streetAddress: String(payload.pickupAddressLine1).trim(),
								city: String(payload.pickupCity).trim(),
								postcode: String(payload.pickupPostcode).trim(),
								latitude: payload.pickupLatitude,
								longitude: payload.pickupLongitude,
								country: 'UK',
								phoneNumber: payload.pickupPhoneNumber,
								email: payload.pickupEmailAddress,
								firstName: payload.pickupFirstName,
								lastName: payload.pickupLastName,
								businessName: payload.pickupBusinessName,
								instructions: payload.pickupInstructions
							},
							deliveries: [
								{
									id: genDeliveryId(),
									orderReference: payload.drops[0]['reference'],
									description: payload.drops[0]['packageDescription'],
									dropoffStartTime: payload.drops[0].packageDropoffStartTime,
									dropoffEndTime: payload.drops[0].packageDropoffEndTime,
									transport: vehicleSpecs.name,
									dropoffLocation: {
										fullAddress: payload.drops[0].dropoffAddress,
										streetAddress:
											payload.drops[0].dropoffAddressLine1 + payload.drops[0].dropoffAddressLine2,
										city: payload.drops[0].dropoffCity,
										postcode: payload.drops[0].dropoffPostcode,
										country: 'UK',
										latitude: payload.drops[0].dropoffLatitude,
										longitude: payload.drops[0].dropoffLongitude,
										phoneNumber: payload.drops[0].dropoffPhoneNumber,
										email: payload.drops[0].dropoffEmailAddress,
										firstName: payload.drops[0].dropoffFirstName,
										lastName: payload.drops[0].dropoffLastName,
										businessName: payload.drops[0].dropoffBusinessName
											? payload.drops[0].dropoffBusinessName
											: '',
										instructions: payload.drops[0].dropoffInstructions
											? payload.drops[0].dropoffInstructions
											: ''
									},
									trackingURL: '',
									status: STATUS.PENDING
								}
							]
						},
						selectedConfiguration: {
							createdAt: moment().format(),
							deliveryFee: settings ? settings.driverDeliveryFee : 5.0,
							winnerQuote: 'N/A',
							providerId: PROVIDERS.PRIVATE,
							quotes: []
						},
						dispatchMode: DISPATCH_MODES.AUTO,
						status: STATUS.PENDING,
						trackingHistory: [
							{
								timestamp: moment().unix(),
								status: STATUS.NEW
							}
						],
						vehicleType: payload.vehicleType
					};
					return await finaliseJob(user, job, clientId, commissionCharge, driver, settings, settings.sms);
				}
				// autoDispatch is disabled, then create the job as a private job without assigning it to a driver
				// specify dispatchMode = MANUAL
			} else {
				console.log('*****************************************');
				console.log('AUTO DISPATCH DISABLED!');
				console.log('*****************************************');
				job = {
					createdAt: moment().format(),
					driverInformation: {
						name: `NO DRIVER ASSIGNED`,
						phone: '',
						transport: ''
					},
					jobSpecification: {
						id: genDeliveryId(),
						jobReference: clientRefNumber,
						orderNumber: orderId.generate(),
						deliveryType: payload.packageDeliveryType,
						pickupStartTime: payload.packagePickupStartTime,
						pickupEndTime: payload.packagePickupEndTime,
						pickupLocation: {
							fullAddress: payload.pickupAddress,
							streetAddress: String(payload.pickupAddressLine1).trim(),
							city: String(payload.pickupCity).trim(),
							postcode: String(payload.pickupPostcode).trim(),
							latitude: payload.pickupLatitude,
							longitude: payload.pickupLongitude,
							country: 'UK',
							phoneNumber: payload.pickupPhoneNumber,
							email: payload.pickupEmailAddress,
							firstName: payload.pickupFirstName,
							lastName: payload.pickupLastName,
							businessName: payload.pickupBusinessName,
							instructions: payload.pickupInstructions
						},
						deliveries: [
							{
								id: genDeliveryId(),
								orderReference: payload.drops[0]['reference'],
								description: payload.drops[0]['packageDescription'],
								dropoffStartTime: payload.drops[0].packageDropoffStartTime,
								dropoffEndTime: payload.drops[0].packageDropoffEndTime,
								transport: vehicleSpecs.name,
								dropoffLocation: {
									fullAddress: payload.drops[0].dropoffAddress,
									streetAddress:
										payload.drops[0].dropoffAddressLine1 + payload.drops[0].dropoffAddressLine2,
									city: payload.drops[0].dropoffCity,
									postcode: payload.drops[0].dropoffPostcode,
									country: 'UK',
									latitude: payload.drops[0].dropoffLatitude,
									longitude: payload.drops[0].dropoffLongitude,
									phoneNumber: payload.drops[0].dropoffPhoneNumber,
									email: payload.drops[0].dropoffEmailAddress,
									firstName: payload.drops[0].dropoffFirstName,
									lastName: payload.drops[0].dropoffLastName,
									businessName: payload.drops[0].dropoffBusinessName
										? payload.drops[0].dropoffBusinessName
										: '',
									instructions: payload.drops[0].dropoffInstructions
										? payload.drops[0].dropoffInstructions
										: ''
								},
								trackingURL: '',
								status: STATUS.NEW
							}
						]
					},
					selectedConfiguration: {
						createdAt: moment().format(),
						deliveryFee: settings ? settings.driverDeliveryFee : 5.0,
						winnerQuote: 'N/A',
						providerId: PROVIDERS.UNASSIGNED,
						quotes: []
					},
					dispatchMode: DISPATCH_MODES.MANUAL,
					status: STATUS.NEW,
					trackingHistory: [
						{
							timestamp: moment().unix(),
							status: STATUS.NEW
						}
					],
					vehicleType: payload.vehicleType
				};
				return await finaliseJob(user, job, clientId, commissionCharge, null, settings, settings.sms);
			}
		}
		// if the default dispatcher = COURIER, attempt to send the job to a third party courier
		// This is the default option for new users who have not set up their business workflow
		const QUOTES = await getResultantQuotes(payload, vehicleSpecs, jobDistance, settings);
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		if (!bestQuote) {
			const error = new Error('No couriers available at this time. Please try again later!');
			error.status = 500;
			throw error;
		}
		const providerId = bestQuote.providerId;
		const winnerQuote = bestQuote.id;
		const {
			id: spec_id,
			deliveryFee,
			pickupAt,
			delivery
		} = await providerCreatesJob(
			providerId.toLowerCase(),
			clientRefNumber,
			selectionStrategy,
			payload,
			vehicleSpecs
		);
		job = {
			createdAt: moment().format(),
			driverInformation: {
				name: 'Searching',
				phone: 'Searching',
				transport: vehicleSpecs.name
			},
			jobSpecification: {
				id: spec_id,
				jobReference: clientRefNumber,
				...ecommerceIds,
				orderNumber: orderId.generate(),
				deliveryType: payload.packageDeliveryType,
				pickupStartTime: pickupAt,
				pickupEndTime: payload.packagePickupEndTime,
				pickupLocation: {
					fullAddress: payload.pickupAddress,
					streetAddress: payload.pickupAddressLine1,
					city: payload.pickupCity,
					postcode: payload.pickupPostcode,
					latitude: payload.pickupLatitude,
					longitude: payload.pickupLongitude,
					country: 'UK',
					phoneNumber: payload.pickupPhoneNumber,
					email: payload.pickupEmailAddress,
					firstName: payload.pickupFirstName,
					lastName: payload.pickupLastName,
					businessName: payload.pickupBusinessName,
					instructions: payload.pickupInstructions
				},
				deliveries: [delivery]
			},
			selectedConfiguration: {
				createdAt: moment().format(),
				deliveryFee: deliveryFee.toFixed(2),
				winnerQuote,
				providerId,
				quotes: QUOTES
			},
			dispatchMode: DISPATCH_MODES.AUTO,
			status: STATUS.NEW,
			trackingHistory: [
				{
					timestamp: moment().unix(),
					status: STATUS.NEW
				}
			],
			vehicleType: payload.vehicleType
		};
		if (settings && deliveryFee.toFixed(2) > settings.courierPriceThreshold) {
			let template = `The price for one of your orders has exceeded your courier price range of £${
				settings.courierPriceThreshold
			}.\nDelivery Fee: £${deliveryFee.toFixed(2)}\nOrder Number: ${job.jobSpecification.orderNumber}`;
			sendSMS(user.phone, template, { smsCommission: '' }, true).then(() => console.log('Alert has been sent!'));
			const title = `Price threshold reached!`;
			const content = `The price for one of your orders has exceeded your courier price range of £${
				settings.courierPriceThreshold}.\nDelivery Fee: £${deliveryFee.toFixed(2)}\nOrder Number: ${job.jobSpecification.orderNumber}`
			sendNotification(clientId, title, content).then(() => console.log("notification sent!"))
		}
		return await finaliseJob(
			user,
			job,
			clientId,
			commissionCharge,
			null,
			settings,
			settings ? settings.sms : false
		);
	} catch (err) {
		console.error(err);
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed ${type} order #${id}`,
			html: `<div><p>OrderId: ${id}</p><p>${type} E-commerce Store: ${domain}</p><p>Job could not be created. <br/>Reason: ${err.message}</p></div>`
		});
		const customerName = `${payload.drops[0].dropoffFirstName} ${payload.drops[0].dropoffLastName}`
		const title = `Failed Order`
		const reason = `One of your orders could not be created. See details below:\n\nStore: ${domain}\nOrderId: ${id}\nCustomer: ${customerName}\nReason: ${err.message}`
		sendNotification(user.clientId, title, reason).then(() => console.log("notification sent!"))
		return err;
	}
}

module.exports = createEcommerceJob;