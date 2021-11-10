require('dotenv').config();
const express = require('express');
const db = require('../models');
const { Client } = require('@googlemaps/google-maps-services-js');
const {
	genJobReference,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob,
	getVehicleSpecs,
	calculateJobDistance,
	checkAlternativeVehicles,
	checkDeliveryHours,
	setNextDayDeliveryTime,
} = require('../helpers');
const { DELIVERY_TYPES, VEHICLE_CODES_MAP, VEHICLE_CODES, STATUS, COMMISSION } = require('../constants');
const moment = require('moment');
const { DELIVERY_METHODS } = require('../constants/shopify');
const { v4: uuidv4 } = require('uuid');
const sendEmail = require('../services/email');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const router = express.Router();
const orderId = require('order-id')(process.env.UID_SECRET_KEY)

const client = new Client();

async function geocodeAddress(address) {
	try {
		console.log(address);
		const response = (
			await client.geocode({
				params: {
					address,
					key: process.env.GOOGLE_MAPS_API_KEY,
				},
			})
		).data;

		if (response.results.length) {
			const formattedAddress = {
				street: '',
				city: '',
				postcode: '',
			};
			let fullAddress = response.results[0].formatted_address;
			let components = response.results[0].address_components;
			/*console.log('**************************************************');
			console.log(components);
			console.log('**************************************************');*/
			components.forEach(({ long_name, types }) => {
				switch (types[0]) {
					case 'street_number':
						formattedAddress.street = formattedAddress.street + long_name;
						break;
					case 'route':
						formattedAddress.street = formattedAddress.street + ' ' + long_name;
						break;
					case 'postal_town':
						formattedAddress.city = long_name;
						break;
					case 'postal_code':
						formattedAddress.postcode = long_name;
						break;
					default:
						break;
				}
			});
			return { fullAddress, formattedAddress };
		}
		throw new Error('No Address suggestions found');
	} catch (e) {
		console.error(e);
		throw e;
	}
}

function convertWeightToVehicleCode(total_weight) {
	console.log('Total Weight:', total_weight, 'kg');
	let vehicleName = 'Bicycle';
	let vehicleCode = 'BIC';
	VEHICLE_CODES.forEach(code => {
		const { name, weight } = VEHICLE_CODES_MAP[code];
		if (total_weight > weight) {
			vehicleCode = code;
			vehicleName = name;
		}
	});
	return { vehicleName, vehicleCode };
}

async function createNewJob(order, user) {
	try {
		console.log('************************************');
		console.log(order);
		console.log('************************************');
		const itemsCount = order.line_items.reduce((prev, curr) => prev + curr.quantity, 0);
		const packageDescription = order.line_items.map(item => item['title']).join('\n');
		console.log(order['total_weight']);
		const vehicleType = convertWeightToVehicleCode(order['total_weight'] / 1000).vehicleCode;
		console.log('DETAILS');
		console.table({ itemsCount, packageDescription, vehicleType });
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.shipping_address['address1']} ${order.shipping_address['city']} ${order.shipping_address['zip']}`
		);
		const payload = {
			pickupAddress: user.fullAddress,
			pickupFormattedAddress: {
				street: user.address['street'],
				city: user.address['city'],
				postcode: user.address['postcode'],
				countryCode: user.address['countryCode'],
			},
			pickupPhoneNumber: user.phone,
			pickupEmailAddress: user.email,
			pickupBusinessName: user.company,
			pickupFirstName: user.firstname,
			pickupLastName: user.lastname,
			pickupInstructions: order['note'] ? order['note'] : '',
			dropoffAddress: fullAddress,
			dropoffFormattedAddress: {
				street: formattedAddress.street,
				city: formattedAddress.city,
				postcode: formattedAddress.postcode,
				countryCode: 'GB',
			},
			dropoffPhoneNumber: order['shipping_lines'][0].phone,
			dropoffEmailAddress: order.email ? order.email : order.customer.email,
			dropoffBusinessName: order.shipping_address.company,
			dropoffFirstName: order.customer.first_name,
			dropoffLastName: order.customer.last_name,
			dropoffInstructions: order.customer['note'] ? order.customer['note'] : '',
			packagePickupStartTime: undefined,
			packagePickupEndTime: undefined,
			packageDropoffStartTime: undefined,
			packageDropoffEndTime: undefined,
			packageDeliveryType: DELIVERY_TYPES.ON_DEMAND.name,
			packageDescription,
			itemsCount,
			vehicleType,
		};
		console.log('-----------------------------------------------------------------');
		console.log('Payload');
		console.log(payload);
		console.log('-----------------------------------------------------------------');
		let paymentIntent = undefined;
		const clientRefNumber = genJobReference();
		const { _id: clientId, email, selectionStrategy, deliveryHours } = user;
		// get specifications for the vehicle
		let vehicleSpecs = getVehicleSpecs(payload.vehicleType);
		console.log('=====================================');
		console.log('VEHICLE SPECS');
		console.log(vehicleSpecs);
		console.log('=====================================');
		// calculate job distance
		const jobDistance = await calculateJobDistance(
			payload.pickupAddress,
			payload.dropoffAddress,
			vehicleSpecs.travelMode
		);
		// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
		if (jobDistance > vehicleSpecs.maxDistance)
			vehicleSpecs = await checkAlternativeVehicles(
				payload.pickupAddress,
				payload.dropoffAddress,
				jobDistance,
				vehicleSpecs.travelMode
			);
		// check delivery hours
		let canDeliver = checkDeliveryHours(moment().format(), deliveryHours);
		if (!canDeliver) {
			const nextDayDeliveryTime = setNextDayDeliveryTime(deliveryHours);
			payload.packageDeliveryType = DELIVERY_TYPES.NEXT_DAY.name;
			payload.packagePickupStartTime = nextDayDeliveryTime;
			payload.packageDropoffStartTime = moment(nextDayDeliveryTime).add(25, 'minutes').format();
		}
		const QUOTES = await getResultantQuotes(payload, vehicleSpecs);
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		const providerId = bestQuote.providerId;
		const winnerQuote = bestQuote.id;
		let idempotencyKey = uuidv4();
		// check the payment plan and lookup the associated commission fee
		let { fee, limit } = COMMISSION[user.subscriptionPlan.toUpperCase()];
		console.log('--------------------------------');
		console.log('COMMISSION FEE:', fee);
		// check whether the client number of orders has exceeded the limit
		const numOrders = await db.Job.where({ clientId: clientId, status: 'COMPLETED' }).countDocuments();
		console.log('NUM COMPLETED ORDERS:', numOrders);
		console.log('--------------------------------');
		// if so create the payment intent for the new order
		if (numOrders >= limit) {
			paymentIntent = await stripe.paymentIntents.create(
				{
					amount: fee * 100,
					customer: user.stripeCustomerId,
					currency: 'GBP',
					setup_future_usage: 'off_session',
					payment_method: user.paymentMethodId,
					payment_method_types: ['card'],
				},
				{
					idempotencyKey,
				}
			);
			console.log('-------------------------------------------');
			console.log('Payment Intent Created!', paymentIntent);
			console.log('-------------------------------------------');
		}
		const paymentIntentId = paymentIntent ? paymentIntent.id : undefined;
		const {
			id: spec_id,
			trackingURL,
			deliveryFee,
		} = await providerCreatesJob(
			providerId.toLowerCase(),
			clientRefNumber,
			selectionStrategy,
			payload,
			vehicleSpecs
		);

		let job = {
			createdAt: moment().format(),
			jobSpecification: {
				id: spec_id,
				shopifyId: order.id,
				orderNumber: orderId.generate(),
				deliveryType: payload.packageDeliveryType,
				packages: [
					{
						description: packageDescription,
						dropoffLocation: {
							fullAddress: payload.dropoffAddress,
							street_address: payload.dropoffFormattedAddress.street,
							city: payload.dropoffFormattedAddress.city,
							postcode: payload.dropoffFormattedAddress.postcode,
							country: 'UK',
							phoneNumber: payload.dropoffPhoneNumber,
							email: payload.dropoffEmailAddress,
							firstName: payload.dropoffFirstName,
							lastName: payload.dropoffLastName,
							businessName: payload.dropoffBusinessName,
							instructions: payload.dropoffInstructions,
						},
						dropoffStartTime: payload.packageDropoffStartTime,
						dropoffEndTime: payload.packageDropoffEndTime,
						itemsCount,
						pickupStartTime: payload.packagePickupStartTime,
						pickupEndTime: payload.packagePickupEndTime,
						pickupLocation: {
							fullAddress: payload.pickupAddress,
							street_address: payload.pickupFormattedAddress.street,
							city: payload.pickupFormattedAddress.city,
							postcode: payload.pickupFormattedAddress.postcode,
							country: 'UK',
							phoneNumber: payload.pickupPhoneNumber,
							email: payload.pickupEmailAddress,
							firstName: payload.pickupFirstName,
							lastName: payload.pickupLastName,
							businessName: payload.pickupBusinessName,
							instructions: payload.pickupInstructions,
						},
						transport: VEHICLE_CODES_MAP[payload.vehicleType].name,
					},
				],
			},
			selectedConfiguration: {
				jobReference: clientRefNumber,
				createdAt: moment().format(),
				deliveryFee,
				winnerQuote,
				providerId,
				trackingURL,
				quotes: QUOTES,
			},
			status: STATUS.NEW,
		};
		// Append the selected provider job to the jobs database
		const createdJob = await db.Job.create({ ...job, clientId, paymentIntentId });
		console.log(createdJob);
		sendEmails(user.team, job);
		// Add the delivery to the users list of jobs
		await db.User.updateOne({ email: email }, { $push: { jobs: createdJob._id } }, { new: true });
		return true;
	} catch (err) {
		console.error(err);
		return err;
	}
}

async function sendEmails(team, job) {
	try {
		console.log(job)
		let allSent = await Promise.all(
			team.map(async ({name, email}) =>
				await sendEmail({
					email: email,
					name: name,
					subject: 'New delivery job',
					templateId: 'd-aace035dda44493e8cc507c367da3a03',
					templateData: {
						address: job.jobSpecification.packages[0].dropoffLocation.fullAddress,
						customer: `${job.jobSpecification.packages[0].dropoffLocation.firstName} ${job.jobSpecification.packages[0].dropoffLocation.lastName}`,
						provider: job.selectedConfiguration.providerId,
						price: job.selectedConfiguration.deliveryFee,
						created_at: moment(job.createdAt).format("DD/MM/YYYY HH:mm:ss"),
						eta: job.jobSpecification.packages[0].pickupStartTime ? moment().to(moment(job.jobSpecification.packages[0].pickupStartTime)) : "N/A",
						unsubscribe: "https://useseconds.com"
					}
				})
			)
		);
		console.log(allSent)
		return allSent
	} catch (err) {
		console.error(err.response.body);
	}
}

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const topic = req.headers['x-shopify-topic'];
		const shop = req.headers['x-shopify-shop-domain'];
		console.table({ topic, shop });
		if (topic === 'orders/create') {
			console.log('-----------------------------');
			console.log('ORDER ID:');
			console.log(req.body.id);
			console.log('-----------------------------');
			// check that the shop domain belongs to a user
			const user = await db.User.findOne({ 'shopify.domain': shop });
			console.log('User Found:', !!user);
			if (user) {
				// CHECK if the incoming delivery is a local delivery
				const isLocalDelivery = req.body['shipping_lines'][0].code === DELIVERY_METHODS.LOCAL;
				const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
				console.log('isLocalDelivery:', isLocalDelivery);
				if (isLocalDelivery) {
					if (isSubscribed) {
						createNewJob(req.body, user);
						res.status(200).json({
							success: true,
							status: 'DELIVERY_JOB_CREATED',
							message: 'webhook received',
						});
					} else {
						console.error('No subscription detected!');
						return res.status(200).json({
							success: false,
							status: 'NO_SUBSCRIPTION',
							message:
								'We cannot carry out orders without a subscription. Please subscribe to one of our business plans!',
						});
					}
				} else {
					res.status(200).json({
						success: false,
						status: 'NON_LOCAL_DELIVERY',
						message:
							'Seconds can only fulfill orders using the local delivery method\n' +
							'See https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-methods/local-delivery for reference ',
					});
				}
			} else {
				res.status(200).json({
					success: false,
					status: 'USER_NOT_FOUND',
					message: `Failed to find a user with shopify domain ${shop}`,
				});
			}
		} else if (topic === 'fulfillments/create') {
			console.log('-----------------------------');
			console.log('Fulfillment:');
			console.log(req.body);
			console.log('-----------------------------');
		} else {
			res.status(200).json({
				success: false,
				status: 'UNKNOWN_TOPIC',
				message: `Webhook topic ${topic} is not recognised`,
			});
		}
	} catch (err) {
		console.error(err);
		res.status(200).json({
			success: false,
			STATUS: 'INTERNAL_SERVER_ERROR',
			message: err.message,
		});
	}
});

module.exports = router;
