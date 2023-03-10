require('dotenv').config();
const express = require('express');
const db = require('../models');
const router = express.Router();
const {
	geocodeAddress,
	convertWeightToVehicleCode,
} = require('../helpers');
const moment = require('moment');
const { DELIVERY_METHODS } = require('../constants/shopify');
const sendEmail = require('../services/email');
const createEcommerceJob = require('../services/ecommerce');
const { PLATFORMS } = require('@seconds-technologies/database_schemas/constants');
const orderId = require('order-id')(process.env.UID_SECRET_KEY);

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
			// set deliveryTo time to be 9pm on the same day
			deliverTo = moment({ M: deliverFrom.month(), d: deliverFrom.date(), h: 21, m: 0 });
			return { deliverFrom, deliverTo, isValid: true };
		} else {
			// else use the shop's delivery hours to set the pickup / dropoff time window
			const dayOfMonth = moment(`${date}`).get('date');
			const dayOfWeek = moment(`${date}`, 'DD-MM=YYYY').day();
			const openHour = deliveryHours[dayOfWeek].open.h;
			const openMinute = deliveryHours[dayOfWeek].open.m;
			const closeHour = deliveryHours[dayOfWeek].close.h;
			const closeMinute = deliveryHours[dayOfWeek].close.m;
			console.table({ dayOfMonth, dayOfWeek, openHour, openMinute, closeHour, closeMinute });
			deliverFrom = moment({ d: dayOfMonth, h: openHour, m: openMinute }).diff(moment()) < 0 ? moment().add(20, 'minutes') : moment({ d: dayOfMonth, h: openHour, m: openMinute });
			deliverTo = moment({ d: dayOfMonth, h: closeHour, m: closeMinute });
			return { deliverFrom, deliverTo, isValid: true };
		}
	}
	return { deliverFrom: null, deliverTo: null, isValid: false };
}

async function generatePayload(order, user, settings) {
	try {
		console.log('************************************');
		console.log(order);
		console.log('************************************');
		const itemsCount = order.line_items.reduce((prev, curr) => prev + curr.quantity, 0);
		const packageDescription = order.line_items.map(item => item['title']).join(', ');
		console.log(order['total_weight']);
		const vehicleType = convertWeightToVehicleCode(order['total_weight'] / 1000).vehicleCode;
		console.log('DETAILS');
		console.table({ itemsCount, vehicleType });
		console.log(packageDescription);
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.shipping_address['address1']} ${order.shipping_address['address2']} ${order.shipping_address['city']} ${order.shipping_address['zip']}`
		);
		console.log('Geocoded results');
		console.log(fullAddress);
		console.table(formattedAddress);
		const geolocation = user.address.geolocation.toObject();
		const payload = {
			pickupAddress: user.fullAddress,
			pickupAddressLine1: user.address['street'],
			pickupCity: user.address['city'],
			pickupPostcode: user.address['postcode'],
			pickupLongitude: geolocation.coordinates[0],
			pickupLatitude: geolocation.coordinates[1],
			pickupPhoneNumber: user.phone,
			pickupEmailAddress: user.email,
			pickupBusinessName: user.company,
			pickupFirstName: user.firstname,
			pickupLastName: user.lastname,
			pickupInstructions: settings.pickupInstructions ? settings.pickupInstructions : '',
			packagePickupStartTime: moment().add(45, 'minutes').format(),
			packagePickupEndTime: undefined,
			packageDeliveryType: 'ON_DEMAND',
			itemsCount,
			vehicleType,
			parcelWeight: order['total_weight'] / 1000,
			drops: [
				{
					dropoffAddress: `${order.shipping_address['address1']} ${order.shipping_address['address2']} ${order.shipping_address['city']} ${order.shipping_address['zip']}`,
					dropoffAddressLine1: order.shipping_address['address1'],
					dropoffAddressLine2: order.shipping_address['address2'],
					dropoffCity: order.shipping_address['city']
						? order.shipping_address['city']
						: formattedAddress.city,
					dropoffPostcode: order.shipping_address['zip']
						? order.shipping_address['zip']
						: formattedAddress.postcode,
					dropoffLongitude: formattedAddress.longitude,
					dropoffLatitude: formattedAddress.latitude,
					dropoffPhoneNumber: order['shipping_lines'][0].phone ? order['shipping_lines'][0].phone : order.shipping_address.phone,
					dropoffEmailAddress: order.email ? order.email : order.customer.email,
					dropoffBusinessName: order.shipping_address.company ? order.shipping_address.company : '',
					dropoffFirstName: order.shipping_address.first_name,
					dropoffLastName: order.shipping_address.last_name,
					dropoffInstructions: order['note'] ? order['note'] : order.customer['note'] ? order.customer['note'] : '',
					packageDropoffEndTime: moment().add(3, 'hours').format(),
					packageDescription,
					reference: orderId.generate()
				}
			]
		};
		console.log("************************************************************")
		console.table({DROPOFF: payload.drops[0].packageDropoffEndTime})
		console.log("************************************************************")
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
		return payload;
	} catch (err) {
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed Shopify order #${order.id}`,
			html: `<div><p>Order Id: #${order.id}</p><p>Shopify Domain: ${user.shopify.domain}</p><p>Job could not be created. <br/>Reason: ${err.message}</p></div>`
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
				// check that the platform integration is enabled for that user
				const isEnabled = user['shopify'].active
				console.log('isEnabled:', isEnabled);
				if (isEnabled) {
					// grab the settings for that user (if they have been set)
					const settings = await db.Settings.findOne({ clientId: user['_id'] })
					console.log('Settings:', !!settings);
					// CHECK if the incoming delivery is a local delivery
					const isLocalDelivery = Object.values(DELIVERY_METHODS).includes(req.body['shipping_lines'][0].code) || req.body['tags'].includes(DELIVERY_METHODS.LOCAL.toUpperCase());
					const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
					console.log('isLocalDelivery:', isLocalDelivery);
					if (isLocalDelivery) {
						if (isSubscribed) {
							generatePayload(req.body, user, settings)
								.then(payload => {
									const ids = { shopifyId: req.body.id, woocommerceId: null };
									createEcommerceJob(PLATFORMS.SHOPIFY, req.body.id, payload, ids, user, settings, shop).then(() => console.log("SUCCESS"));
								})
								.catch(err => console.error(err));
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
						status: 'INACTIVE_INTEGRATION_STATUS',
						message: `The user has disabled this platform integration`
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
