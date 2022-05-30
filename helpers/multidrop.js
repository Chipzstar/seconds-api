const { PROVIDERS, STATUS, SELECTION_STRATEGIES, VEHICLE_CODES_MAP, DELIVERY_TYPES } = require('@seconds-technologies/database_schemas/constants');
const { dropoffSchema, pickupSchema } = require('../schemas/stuart/CreateJob');
const moment = require('moment-timezone');
const { ERROR_CODES: STUART_ERROR_CODES } = require('../constants/stuart');
const { STRATEGIES } = require('../constants/streetStream');
const { stuartAxios, streetStreamAxios } = require('../utils/axios');
const axios = require('axios');
const { deliverySchema } = require('../schemas');
const orderId = require('order-id')(process.env.UID_SECRET_KEY);

async function providerCreateMultiJob(provider, ref, strategy, request, vehicleSpecs) {
	switch (provider) {
		case PROVIDERS.STUART:
			console.log('Creating STUART Job');
			return await stuartMultiJobRequest(ref, request, vehicleSpecs);
		case PROVIDERS.STREET_STREAM:
			console.log('Creating STREET-STREAM Job');
			return await streetStreamMultiJobRequest(ref, strategy, request, vehicleSpecs);
		case PROVIDERS.ECOFLEET:
			console.log('Creating ECOFLEET Job');
			return await ecofleetMultiJobRequest(ref, request, vehicleSpecs);
		default:
			console.log('Creating STUART Job');
			return await stuartMultiJobRequest(ref, request, vehicleSpecs);
	}
}

async function stuartMultiJobRequest(ref, params, vehicleSpecs) {
	const {
		pickupAddress,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		drops
	} = params;
	const dropoffs = drops.map(
		({
			 dropoffAddress,
			 dropoffPhoneNumber,
			 dropoffEmailAddress,
			 dropoffBusinessName,
			 dropoffFirstName,
			 dropoffLastName,
			 dropoffInstructions,
			 packageDropoffStartTime,
			 packageDropoffEndTime,
			 packageDescription,
			 reference
		 }) => {
			return {
				...dropoffSchema,
				package_type: vehicleSpecs.stuart.packageType,
				package_description: packageDescription,
				client_reference: reference,
				address: dropoffAddress,
				comment: dropoffInstructions,
				contact: {
					firstname: dropoffFirstName,
					lastname: dropoffLastName,
					phone: dropoffPhoneNumber,
					email: dropoffEmailAddress,
					company: dropoffBusinessName
				},
				...(packageDropoffStartTime && { end_customer_time_window_start: packageDropoffStartTime }),
				...(packageDropoffEndTime && { end_customer_time_window_end: packageDropoffEndTime })
			};
		}
	);
	try {
		const payload = {
			job: {
				...(packagePickupStartTime && { pickup_at: moment(packagePickupStartTime).format() }),
				assignment_code: ref,
				pickups: [
					{
						...pickupSchema,
						address: pickupAddress,
						comment: pickupInstructions,
						contact: {
							firstname: pickupFirstName,
							lastname: pickupLastName,
							phone: pickupPhoneNumber,
							email: pickupEmailAddress,
							company: pickupBusinessName
						}
					}
				],
				dropoffs
			}
		};
		const URL = `${process.env.STUART_ENV}/v2/jobs`;
		let data = (await stuartAxios.post(URL, payload)).data;
		console.log('----------------------------');
		console.log(data);
		console.log('----------------------------');
		let deliveries = data['deliveries'].map(delivery => ({
			id: delivery.id,
			orderNumber: orderId.generate(),
			orderReference: delivery.client_reference,
			description: delivery.package_description,
			dropoffStartTime: delivery.eta['dropoff'] ? moment(delivery.eta['dropoff']).format() : data['dropoff_at'],
			dropoffEndTime: delivery.eta['dropoff'] ? moment(delivery.eta['dropoff']).format() : data['dropoff_at'],
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: `${delivery['dropoff']['address']['street']} ${delivery['dropoff']['address']['city']} ${delivery['dropoff']['address']['postcode']}`,
				streetAddress: delivery['dropoff']['address']['street'],
				city: delivery['dropoff']['address']['city'],
				postcode: delivery['dropoff']['address']['postcode'],
				latitude: delivery['dropoff']['latitude'],
				longitude: delivery['dropoff']['longitude'],
				country: 'UK',
				phoneNumber: delivery['dropoff']['contact']['phone'],
				email: delivery['dropoff']['contact']['email'],
				firstName: delivery['dropoff']['contact']['firstname'],
				lastName: delivery['dropoff']['contact']['lastname'],
				businessName: delivery['dropoff']['contact']['business_name'],
				instructions: delivery['dropoff']['comment']
			},
			trackingHistory: [
				{
					timestamp: moment().unix(),
					status: STATUS.NEW
				}
			],
			trackingURL: delivery['tracking_url'],
			status: STATUS.PENDING
		}));
		return {
			id: String(data.id),
			deliveryFee: data['pricing']['price_tax_included'],
			pickupAt: data['pickup_at'],
			deliveries,
			providerId: PROVIDERS.STUART
		};
	} catch (err) {
		if (err.response.status === STUART_ERROR_CODES.UNPROCESSABLE_ENTITY) {
			if (err.response.data.error === STUART_ERROR_CODES.OUT_OF_RANGE) {
				return null;
			} else if (err.response.data.error === STUART_ERROR_CODES.JOB_DISTANCE_NOT_ALLOWED) {
				return null;
			} else if (err.response.data.error === STUART_ERROR_CODES.ADDRESS_CONTACT_PHONE_REQUIRED) {
				throw { status: err.response.status, message: err.response.data.message };
			} else if (err.response.data.error === STUART_ERROR_CODES.PHONE_INVALID) {
				throw { status: err.response.status, message: err.response.data.message };
			} else if (err.response.data.error === STUART_ERROR_CODES.RECORD_INVALID) {
				if (Object.keys(err.response.data.data).includes('deliveries')) {
					throw { status: err.response.status, message: err.response.data.data['deliveries'][1] };
				} else if (Object.keys(err.response.data.data).includes('job.pickup_at')) {
					throw { status: err.response.status, message: err.response.data.data['job.pickup_at'][0] };
				} else if (Object.keys(err.response.data.data).includes('pickup_at')) {
					throw { status: err.response.status, message: err.response.data.data['pickup_at'][0] };
				}
			} else {
				throw { status: err.response.status, ...err.response.data };
			}
		} else if (err.response.status === STUART_ERROR_CODES.INVALID_GRANT) {
			throw { status: err.response.status, ...err.response.data };
		} else {
			throw err;
		}
	}
}

async function streetStreamMultiJobRequest(ref, strategy, params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packagePickupStartTime,
		packagePickupEndTime,
		drops
	} = params;

	let lastDropoffTime = moment().toISOString(true);
	const dropoffs = drops.map(drop => {
		if (moment(drop.packageDropoffEndTime).diff(lastDropoffTime) > 0)
			lastDropoffTime = moment(drop.packageDropoffEndTime).add(30, 'minutes').toISOString(true);
		return {
			contactNumber: drop.dropoffPhoneNumber,
			contactName: `${drop.dropoffFirstName} ${drop.dropoffLastName}`,
			addressOne: drop.dropoffAddressLine1,
			...(drop['dropoffAddressLine2'] && { addressTwo: drop['dropoffAddressLine2'] }),
			city: drop.dropoffCity,
			postcode: drop.dropoffPostcode,
			clientTag: drop.reference,
			deliveryNotes: drop.dropoffInstructions
		};
	});
	console.log('LAST Dropoff Time:', lastDropoffTime);
	try {
		const payload = {
			offerAcceptanceStrategy:
				strategy === SELECTION_STRATEGIES.RATING
					? STRATEGIES.AUTO_HIGHEST_RATED_COURIER
					: STRATEGIES.AUTO_CLOSEST_COURIER_TO_ME,
			courierTransportType: vehicleSpecs.streetVehicleType,
			jobLabel: ref,
			insuranceCover: 'PERSONAL',
			submitForQuotesImmediately: true,
			optimiseRoute: true,
			deliveryFrom: moment(packagePickupStartTime).toISOString(true),
			deliveryTo: lastDropoffTime,
			pickUp: {
				contactNumber: pickupPhoneNumber,
				contactName: `${pickupFirstName} ${pickupLastName}`,
				addressOne: pickupAddressLine1 + pickupAddressLine2,
				city: pickupCity,
				postcode: pickupPostcode,
				pickUpNotes: pickupInstructions,
				pickUpFrom: moment(packagePickupStartTime).add(30, 'minutes').toISOString(true),
				pickUpTo: packagePickupEndTime
					? moment(packagePickupEndTime).add(30, 'minutes').toISOString(true)
					: moment(packagePickupStartTime).add(40, 'minutes').toISOString(true)
			},
			drops: dropoffs
		};
		console.log('---------------------------------------');
		console.log('PAYLOAD');
		console.log(payload);
		console.log('---------------------------------------');
		const multiJobURL = `${process.env.STREET_STREAM_ENV}/api/job/multidrop`;
		const response = await streetStreamAxios.post(multiJobURL, payload);
		if (response.data) {
			let { data } = response;
			let deliveries = data['drops'].map((delivery, index) => ({
				id: delivery.id,
				orderNumber: orderId.generate(),
				orderReference: delivery.clientTag,
				description: delivery['deliveryNotes'],
				dropoffStartTime: delivery['dropOffFrom']
					? moment(delivery['dropOffFrom']).format()
					: drops[index].packageDropoffStartTime,
				dropoffEndTime: delivery['dropOffTo']
					? moment(delivery['dropOffTo']).format()
					: drops[index].packageDropoffEndTime,
				transport: vehicleSpecs.name,
				dropoffLocation: {
					fullAddress: drops[index].dropoffAddress,
					streetAddress: delivery['addressOne'] + delivery['addressTwo'] ? delivery['addressTwo'] : '',
					city: delivery['city'],
					postcode: delivery['postcode'],
					country: 'UK',
					latitude: delivery['latitude'],
					longitude: delivery['longitude'],
					phoneNumber: delivery['contactNumber'],
					email: drops[index].dropoffEmailAddress ? drops[index].dropoffEmailAddress : '',
					firstName: drops[index].dropoffFirstName,
					lastName: drops[index].dropoffLastName,
					businessName: drops[index].dropoffBusinessName ? drops[index].dropoffBusinessName : '',
					instructions: drops[index].dropoffInstructions ? drops[index].dropoffInstructions : ''
				},
				trackingHistory: [
					{
						timestamp: moment().unix(),
						status: STATUS.NEW
					}
				],
				trackingURL: '',
				status: STATUS.PENDING
			}));
			return {
				id: data.id,
				deliveryFee: data['jobCharge']['totalPayableWithVat'],
				pickupAt: data['pickUp']['pickUpFrom'] ? data['pickUp']['pickUpFrom'] : packagePickupStartTime,
				deliveries,
				providerId: PROVIDERS.STREET_STREAM
			};
		} else {
			throw new Error('There was an issue creating your multi drop with street stream');
		}
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function ecofleetMultiJobRequest(refNumber, params, vehicleSpecs) {
	const {
		pickupAddressLine1,
		pickupAddressLine2,
		pickupCity,
		pickupPostcode,
		pickupPhoneNumber,
		pickupEmailAddress,
		pickupBusinessName,
		pickupFirstName,
		pickupLastName,
		pickupInstructions,
		packageDeliveryType,
		packagePickupStartTime,
		packageDescription,
		vehicleType,
		drops
	} = params;

	const dropoffs = drops.map(drop => ({
		name: `${drop.dropoffFirstName} ${drop.dropoffLastName}`,
		company_name: drop.dropoffBusinessName,
		address_line1: drop.dropoffAddressLine1,
		...(drop['dropoffAddressLine2'] && { address_line2: drop['dropoffAddressLine2'] }),
		city: drop.dropoffCity,
		postal: drop.dropoffPostcode,
		country: 'England',
		phone: drop.dropoffPhoneNumber,
		email: drop.dropoffEmailAddress,
		comment: drop.dropoffInstructions
	}));

	const payload = {
		pickup: {
			name: `${pickupFirstName} ${pickupLastName}`,
			company_name: pickupBusinessName,
			address_line1: pickupAddressLine1,
			...(pickupAddressLine2 && { address_line2: pickupAddressLine2 }),
			city: pickupCity,
			postal: pickupPostcode,
			country: 'England',
			phone: pickupPhoneNumber,
			email: pickupEmailAddress,
			comment: pickupInstructions
		},
		drops: dropoffs,
		parcel: {
			weight: VEHICLE_CODES_MAP[vehicleType].weight,
			type: packageDescription ? packageDescription : ''
		},
		schedule: {
			type: DELIVERY_TYPES[packageDeliveryType].ecofleet,
			...(packagePickupStartTime && { pickupWindow: moment(packagePickupStartTime).unix() })
			// ...(drops[0].packageDropoffStartTime && { dropoffWindow: moment(drops[0].packageDropoffStartTime).unix() })
		}
	};
	console.log(payload);
	try {
		const config = { headers: { Authorization: `Bearer ${process.env.ECOFLEET_API_KEY}` } };
		const createJobURL = `${process.env.ECOFLEET_ENV}/api/v1/order`;
		const data = (await axios.post(createJobURL, payload, config)).data;
		console.log(data);
		data.tasks.shift();
		let deliveries = data.tasks.map((task, index) => ({
			...deliverySchema,
			id: task.id,
			orderNumber: orderId.generate(),
			orderReference: drops[index].reference,
			description: drops[index].packageDescription ? drops[index].packageDescription : '',
			dropoffStartTime: drops[index].packageDropoffStartTime,
			dropoffEndTime: drops[index].packageDropoffEndTime,
			transport: vehicleSpecs.name,
			dropoffLocation: {
				fullAddress: drops[index].dropoffAddress,
				streetAddress: task.address,
				city: task.city,
				postcode: task.postal,
				country: 'UK',
				latitude: drops[index].dropoffLatitude,
				longitude: drops[index].dropoffLongitude,
				phoneNumber: task.phone,
				email: task.email ? task.email : '',
				firstName: drops[index].dropoffFirstName,
				lastName: drops[index].dropoffLastName,
				businessName: drops[index].dropoffBusinessName ? drops[index].dropoffBusinessName : '',
				instructions: task.comment ? task.comment : ''
			},
			trackingHistory: [
				{
					timestamp: moment().unix(),
					status: STATUS.NEW
				}
			],
			trackingURL: task['tracking_link'],
			status: STATUS.PENDING
		}));
		return {
			id: data.id,
			deliveryFee: data['amount'],
			pickupAt: packagePickupStartTime ? moment(packagePickupStartTime).format() : undefined,
			deliveries,
			providerId: PROVIDERS.ECOFLEET
		};
	} catch (err) {
		throw err;
	}
}

module.exports = {
	providerCreateMultiJob
}