require('dotenv').config();
const express = require('express');
const db = require('../models');
const router = express.Router();
const {
	genJobReference,
	getResultantQuotes,
	chooseBestProvider,
	providerCreatesJob,
	getVehicleSpecs,
	calculateJobDistance,
	checkPickupHours,
	setNextDayDeliveryTime,
	genOrderReference,
	sendNewJobEmails, geocodeAddress
} = require('../helpers');
const { VEHICLE_CODES_MAP, VEHICLE_CODES, STATUS, COMMISSION } = require('../constants');
const moment = require('moment');
const { DELIVERY_METHODS } = require('../constants/shopify');
const sendEmail = require('../services/email');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const orderId = require('order-id')(process.env.UID_SECRET_KEY);

function convertWeightToVehicleCode(total_weight) {
	console.log('Total Weight:', total_weight, 'kg');
	let vehicleName;
	let vehicleCode;
	for (let code of VEHICLE_CODES) {
		console.log("switching vehicle...")
		const { name, weight } = VEHICLE_CODES_MAP[code];
		console.table({code, name, weight})
		vehicleCode = code;
		vehicleName = name;
		if (total_weight < weight) break;
	}
	return { vehicleName, vehicleCode };
}

function validateDeliveryDate(date, time, deliveryHours) {
	console.table({ date, time });
	// check if date and time are not undefined
	if (date) {
		const [from, to] = time ? time.split(' - ') : [null, null];
		console.table({ from, to });
		// convert delivery date + time (from) into a moment and check it is not in the past
		let deliverFrom = moment(`${date} ${from}`, 'DD-MM-YYYY HH:mm');
		let deliverTo = moment(`${date} ${to}`, 'DD-MM-YYYY HH:mm');
		// check that the two moments are valid
		if (deliverTo.isValid() && deliverFrom.isValid()) {
			// if deliverFrom time is in the past set it to be 20 minutes ahead of the current time
			deliverFrom = deliverFrom.diff(moment()) < 0 ? moment().add(20, 'minutes') : deliverFrom;
			deliverTo = deliverTo.diff(moment()) < 0 ? moment(deliverFrom).add(2, 'hours') : deliverTo;
			return { deliverFrom, deliverTo, isValid: deliverTo.isValid() && deliverFrom.isValid() };
		} else {
			// else use the shop's delivery hours to set the pickup / dropoff time window
			const dayOfMonth = moment(`${date}`).get('date')
			const dayOfWeek = moment(`${date}`, "DD-MM=YYYY").day()
			const openHour = deliveryHours[dayOfWeek].open.h
			const openMinute = deliveryHours[dayOfWeek].open.m
			const closeHour = deliveryHours[dayOfWeek].close.h
			const closeMinute = deliveryHours[dayOfWeek].close.m
			console.table({dayOfMonth, dayOfWeek, openHour, openMinute, closeHour, closeMinute})
			deliverFrom = moment({d: dayOfMonth, h: openHour, m: openMinute})
			deliverTo = moment({d: dayOfMonth, h: closeHour, m: closeMinute})
			return { deliverFrom, deliverTo, isValid: deliverTo.isValid() && deliverFrom.isValid() };
		}
	}
	return { deliverFrom: null, deliverTo: null, isValid: false };
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
		console.table({ itemsCount, vehicleType });
		console.log(packageDescription);
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.shipping_address['address1']} ${order.shipping_address['address2']} ${order.shipping_address['city']} ${order.shipping_address['zip']}`
		);
		console.log(fullAddress);
		console.table(formattedAddress);
		const payload = {
			pickupAddress: user.fullAddress,
			pickupAddressLine1: user.address['street'],
			pickupCity: user.address['city'],
			pickupPostcode: user.address['postcode'],
			pickupLongitude: user.address['geolocation']['coordinates'][0],
			pickupLatitude: user.address['geolocation']['coordinates'][1],
			pickupPhoneNumber: user.phone,
			pickupEmailAddress: user.email,
			pickupBusinessName: user.company,
			pickupFirstName: user.firstname,
			pickupLastName: user.lastname,
			pickupInstructions: order['note'] ? order['note'] : '',
			packagePickupStartTime: moment().add(45, 'minutes').format(),
			packagePickupEndTime: undefined,
			packageDeliveryType: 'ON_DEMAND',
			itemsCount,
			vehicleType,
			parcelWeight: order['total_weight'] / 1000,
			drops: [
				{
					dropoffAddress: fullAddress,
					dropoffAddressLine1: formattedAddress.street,
					dropoffCity: formattedAddress.city,
					dropoffPostcode: formattedAddress.postcode,
					dropoffLongitude: formattedAddress.longitude,
					dropoffLatitude: formattedAddress.latitude,
					dropoffPhoneNumber: order['shipping_lines'][0].phone,
					dropoffEmailAddress: order.email ? order.email : order.customer.email,
					dropoffBusinessName: order.shipping_address.company ? order.shipping_address.company : "",
					dropoffFirstName: order.shipping_address.first_name,
					dropoffLastName: order.shipping_address.last_name,
					dropoffInstructions: order.customer['note'] ? order.customer['note'] : '',
					packageDropoffEndTime: moment().add(200, 'minutes').format(),
					packageDescription,
					reference: genOrderReference()
				}
			]
		};
		// check if delivery date specified by the customer
		if (order['note_attributes']) {
			const [date, time] = order['note_attributes']
				.filter(
					({ name }) =>
						name === 'Delivery-Date' ||
						name === 'Delivery-Time' ||
						name === 'Delivery-date' ||
						name === 'Delivery-time'
				)
				.map(({ value }) => value);
			const { deliverFrom, deliverTo, isValid } = validateDeliveryDate(date, time, user.deliveryHours);
			if (isValid) {
				payload.packagePickupStartTime = deliverFrom.format();
				payload.packagePickupEndTime = undefined;
				payload.drops[0].packageDropoffStartTime = undefined;
				payload.drops[0].packageDropoffEndTime = deliverTo.format();
			}
		}
		console.log('-----------------------------------------------------------------');
		console.log('Payload');
		console.log(payload);
		console.log('-----------------------------------------------------------------');
		let commissionCharge = false;
		let paymentIntent;
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
			const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(payload.packagePickupStartTime, deliveryHours);
			payload.packageDeliveryType = 'NEXT_DAY';
			payload.packagePickupStartTime = nextDayPickup;
			payload.drops[0].packageDropoffEndTime = nextDayDropoff;
		}
		console.log('-----------------------------------------------------------------');
		console.log(payload.packagePickupStartTime);
		console.log('-----------------------------------------------------------------');
		const QUOTES = await getResultantQuotes(payload, vehicleSpecs, jobDistance);
		const bestQuote = chooseBestProvider(selectionStrategy, QUOTES);
		const providerId = bestQuote.providerId;
		const winnerQuote = bestQuote.id;
		// check the payment plan and lookup the associated commission fee
		let { fee, limit } = COMMISSION[user.subscriptionPlan.toUpperCase()];
		console.log('--------------------------------');
		console.log('COMMISSION FEE:', fee);
		// check whether the client number of orders has exceeded the limit
		const numOrders = await db.Job.where({ clientId: clientId, status: 'COMPLETED' }).countDocuments();
		console.log('NUM COMPLETED ORDERS:', numOrders);
		console.log('--------------------------------');
		// if the order limit is exceeded, mark the job with a commission fee charge
		if (numOrders >= limit) commissionCharge = true;
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
		let idempotencyKey = uuidv4();
		paymentIntent = await stripe.paymentIntents.create(
			{
				amount: Math.round(deliveryFee * 100),
				customer: user.stripeCustomerId,
				currency: 'GBP',
				setup_future_usage: 'off_session',
				payment_method: user.paymentMethodId,
				payment_method_types: ['card']
			},
			{
				idempotencyKey
			}
		);
		console.log('-------------------------------------------');
		console.log('Payment Intent Created!', paymentIntent.id);
		console.log('-------------------------------------------');
		const paymentIntentId = paymentIntent ? paymentIntent.id : undefined;
		let job = {
			createdAt: moment().format(),
			jobSpecification: {
				id: spec_id,
				jobReference: clientRefNumber,
				shopifyId: order.id,
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
				deliveryFee,
				winnerQuote,
				providerId,
				quotes: QUOTES
			},
			status: STATUS.NEW
		};
		// Append the selected provider job to the jobs database
		const createdJob = await db.Job.create({ ...job, clientId, commissionCharge, paymentIntentId });
		console.log(createdJob);
		await sendNewJobEmails(user.team, job);
		return true;
	} catch (err) {
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed Shopify order #${order.id}`,
			text: `Job could not be created. Reason: ${err.message}`,
			html: `<p>Job could not be created. Reason: ${err.message}</p>`
		});
		console.error(err);
		return err;
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
			const user = await db.User.findOne({ 'shopify.domain': shop.toLowerCase() });
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
							message: 'webhook received'
						});
					} else {
						console.error('No subscription detected!');
						return res.status(200).json({
							success: false,
							status: 'NO_SUBSCRIPTION',
							message:
								'We cannot carry out orders without a subscription. Please subscribe to one of our business plans!'
						});
					}
				} else {
					res.status(200).json({
						success: false,
						status: 'NON_LOCAL_DELIVERY',
						message:
							'Seconds can only fulfill orders using the local delivery method\n' +
							'See https://help.shopify.com/en/manual/shipping/setting-up-and-managing-your-shipping/local-methods/local-delivery for reference '
					});
				}
			} else {
				res.status(200).json({
					success: false,
					status: 'USER_NOT_FOUND',
					message: `Failed to find a user with shopify domain ${shop}`
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
				message: `Webhook topic ${topic} is not recognised`
			});
		}
	} catch (err) {
		console.error(err);
		res.status(200).json({
			success: false,
			STATUS: 'INTERNAL_SERVER_ERROR',
			message: err.message
		});
	}
});

module.exports = router;
