require('dotenv').config();
const express = require('express');
const db = require('../models');
const { DELIVERY_METHODS } = require('../constants/shopify');
const axios = require('axios');
const sendEmail = require('../services/email');
const { convertWeightToVehicleCode, geocodeAddress, genOrderReference, createEcommerceJob } = require('../helpers');
const moment = require('moment');
const router = express.Router();

async function generatePayload(order, user) {
	try {
		console.log('************************************');
		console.log(order);
		console.log('************************************');
		const itemsCount = order.line_items.reduce((prev, curr) => prev + curr.quantity, 0)
		// iterate through each product and record its weight multiplied by the quantity
		const weights = await Promise.all(
			order['line_items'].map(async ({ product_id, quantity }) => {
				const endpoint = `/wp-json/wc/v3/products/${product_id}`;
				const URL = `${user.woocommerce.domain}${endpoint}`;
				console.log(URL);
				let response = (
					await axios.get(URL, {
						auth: {
							username: user.woocommerce.consumerKey,
							password: user.woocommerce.consumerSecret
						}
					})
				).data;
				console.log(response);
				return Number(response.weight) * Number(quantity);
			})
		);
		console.log(weights);
		const totalWeight = weights.reduce((prev, curr) => prev + curr, 0)
		const vehicleType = convertWeightToVehicleCode(totalWeight).vehicleCode
		const packageDescription = order.line_items.map(item => item['name']).join('\n');
		console.table({totalWeight, vehicleType, packageDescription})
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.shipping['address_1']} ${order.shipping['address_2']} ${order.shipping['city']} ${order.shipping['postcode']}`
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
			pickupInstructions: '',
			packagePickupStartTime: moment().add(45, 'minutes').format(),
			packagePickupEndTime: undefined,
			packageDeliveryType: 'ON_DEMAND',
			itemsCount,
			vehicleType,
			parcelWeight: totalWeight,
			drops: [
				{
					dropoffAddress: `${order.shipping['address_1']} ${order.shipping['address_2']} ${order.shipping['city']} ${order.shipping['postcode']}`,
					dropoffAddressLine1: order.shipping['address_1'],
					dropoffAddressLine2: order.shipping['address_2'],
					dropoffCity: order.shipping['city']
						? order.shipping['city']
						: formattedAddress.city,
					dropoffPostcode: order.shipping['postcode'] ? order.shipping['postcode'] : formattedAddress.postcode ,
					dropoffLongitude: formattedAddress.longitude,
					dropoffLatitude: formattedAddress.latitude,
					dropoffPhoneNumber: order.shipping['phone'],
					dropoffEmailAddress: order.billing.email ? order.billing.email : "",
					dropoffBusinessName: order.shipping.company ? order.shipping.company : '',
					dropoffFirstName: order.shipping.first_name,
					dropoffLastName: order.shipping.last_name,
					dropoffInstructions: order['customer_note'] ? order['customer_note'] : '',
					packageDropoffEndTime: moment().add(200, 'minutes').format(),
					packageDescription,
					reference: genOrderReference()
				}
			]
		};
		console.log('-----------------------------------------------------------------');
		console.log('Payload');
		console.log(payload);
		console.log('-----------------------------------------------------------------');
		return payload;
	} catch (err) {
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed Woocommerce order #${order['order_key']}`,
			html: `<div><p>OrderId: ${order['order_key']}</p><br/><p>Woocommerce Domain: ${user.woocommerce.domain}</p><p>Job could not be created. <br/>Reason: ${err.message}</p></div>`
		});
		console.error(err);
		return err;
	}
}

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const topic = req.headers['x-wc-webhook-topic'];
		const domain = req.headers['x-wc-webhook-source'].endsWith('/')
			? req.headers['x-wc-webhook-source'].slice(0, -1)
			: req.headers['x-wc-webhook-source'];
		console.table({ topic, domain });
		// check that the shop domain belongs to a user
		const user = await db.User.findOne({ 'woocommerce.domain': domain });
		console.log('User Found:', !!user);
		if (user) {
			if (topic === 'order.created') {
				console.log('-----------------------------');
				console.log('ORDER ID:');
				console.table({ id: req.body.id, orderKey: req.body['order_key'] });
				console.log('-----------------------------');
				// CHECK if the incoming delivery is a local delivery
				const isLocalDelivery = req.body['shipping_lines'][0]['method_title'] === DELIVERY_METHODS.LOCAL;
				const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
				console.log('isLocalDelivery:', isLocalDelivery);
				if (isLocalDelivery) {
					if (isSubscribed) {
						generatePayload(req.body, user).then(payload => {
							const ids = { shopifyId: null, woocommerceId: req.body['order_key']}
							createEcommerceJob("WooCommerce", req.body['order_key'], payload, ids, user, domain)
						}).catch(err => console.error(err));
						res.status(200).json({
							success: true,
							status: 'ORDER_RECEIVED',
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
						message: 'Seconds can only fulfill orders using the local delivery method'
					});
				}
			} else {
				console.log('Unknown topic');
				res.status(200).json({
					success: false,
					status: 'UNKNOWN_TOPIC',
					message: `Webhook topic ${topic} is not recognised`
				});
			}
		} else {
			res.status(200).json({
				success: false,
				status: 'USER_NOT_FOUND',
				message: `Failed to find a user with square shop ${domain}`
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
