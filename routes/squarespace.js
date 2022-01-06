require('dotenv').config();
const express = require('express');
const db = require('../models');
const { DELIVERY_METHODS } = require('../constants/shopify');
const axios = require('axios');
const sendEmail = require('../services/email');
const { convertWeightToVehicleCode, geocodeAddress, genOrderReference, createEcommerceJob } = require('../helpers');
const moment = require('moment');
const router = express.Router();
const squarespaceAxios = axios.create();

async function refreshSquarespaceToken(refreshToken) {
	try {
		const URL = 'https://login.squarespace.com/api/1/login/oauth/provider/tokens';
		const payload = {
			grant_type: 'refresh_token',
			refresh_token: refreshToken
		};
		const token = Buffer.from(`${process.env.SQUARESPACE_CLIENT_ID}:${process.env.SQUARESPACE_SECRET}`).toString(
			'base64'
		);
		const { access_token, access_token_expires_at, refresh_token, refresh_token_expires_at } = (
			await axios.post(URL, payload, { headers: { Authorization: `Basic ${token}` } })
		).data;
		return { access_token, access_token_expires_at, refresh_token, refresh_token_expires_at }
	} catch (err) {
		console.error(err);
	}
}

squarespaceAxios.interceptors.response.use(
	response => {
		return response;
	},
	error => {
		console.log(error.response.data);
		if (
			error.response &&
			error.response.status === 401 &&
			error.response.data.message === 'You are not authorized to do that.'
		) {
			return refreshSquarespaceToken(error.config['RefreshToken'])
				.then(({ refresh_token, access_token }) => {
					error.config.headers['Authorization'] = `Bearer ${access_token}`;
					error.config.headers['RefreshToken'] = refresh_token
					return squarespaceAxios.request(error.config);
				})
				.catch(err => Promise.reject(err));
		}
		return Promise.reject(error);
	}
);

async function generatePayload(order, user) {
	try {
		console.log('************************************');
		console.log(order);
		console.log('************************************');
		const itemsCount = order['lineItems'].reduce((prev, curr) => prev + curr.quantity, 0);
		// iterate through each product and record its weight multiplied by the quantity
		const totalWeight = order['lineItems'].reduce(
			(prev, curr) => prev + Number(curr.weight) * Number(curr.quantity),
			0
		);
		const vehicleType = convertWeightToVehicleCode(totalWeight).vehicleCode;
		const packageDescription = order['lineItems'].map(item => item['productName']).join('\n');
		console.table({ totalWeight, vehicleType, packageDescription });
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.shippingAddress['address1']} ${order.shippingAddress['address2']} ${order.shippingAddress['city']} ${order.shippingAddress['postalCode']}`
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
					dropoffAddress: `${order.shippingAddress['address1']} ${order.shippingAddress['address2']} ${order.shippingAddress['city']} ${order.shippingAddress['postalCode']}`,
					dropoffAddressLine1: order.shippingAddress['address1'],
					dropoffAddressLine2: order.shippingAddress['address2'],
					dropoffCity: order.shippingAddress['city'] ? order.shippingAddress['city'] : formattedAddress.city,
					dropoffPostcode: order.shippingAddress['postalCode']
						? order.shippingAddress['postalCode']
						: formattedAddress.postcode,
					dropoffLongitude: formattedAddress.longitude,
					dropoffLatitude: formattedAddress.latitude,
					dropoffPhoneNumber: order.shippingAddress['phone'],
					dropoffEmailAddress: order.customerEmail ? order.customerEmail : '',
					dropoffBusinessName: order.shippingAddress.company ? order.shippingAddress.company : '',
					dropoffFirstName: order.shippingAddress.first_name,
					dropoffLastName: order.shippingAddress.last_name,
					dropoffInstructions: order['internalNotes'] ? order['internalNotes'] : '',
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
			subject: `Failed Squarespace order #${order.id}`,
			text: `Job could not be created. Reason: ${err.message}`,
			html: `<p>Job could not be created. Reason: ${err.message}</p>`
		});
		console.error(err);
		return err;
	}
}

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop siteId
		const { topic, websiteId, data } = req.body;
		console.table({ topic, websiteId });
		// check that the shop domain belongs to a user
		const user = await db.User.findOne({ 'squarespace.siteId': websiteId });
		console.log('User Found:', !!user);
		if (user) {
			console.log(data);
			if (topic === 'order.create') {
				console.log('-----------------------------');
				console.log('ORDER ID:', data['orderId']);
				// retrieve full order information
				let URL = `https://api.squarespace.com/1.0/commerce/orders/${data['orderId']}`;
				const order = (
					await squarespaceAxios.get(URL, {
						headers: {
							Authorization: `Bearer ${user.squarespace.accessToken}`,
							RefreshToken: user.squarespace.refreshToken
						}
					})
				).data;
				console.log('-----------------------------');
				// CHECK if the incoming delivery is a local delivery
				const isLocalDelivery = order['shippingLines'][0]['method'] === DELIVERY_METHODS.LOCAL;
				const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
				console.log('isLocalDelivery:', isLocalDelivery);
				if (isLocalDelivery) {
					if (isSubscribed) {
						generatePayload(order, user)
							.then(payload => {
								const ids = { shopifyId: null, woocommerceId: null, squarespaceId: data['orderId'] };
								createEcommerceJob('Squarespace', data['orderId'], payload, ids, user);
							})
							.catch(err => console.error(err));
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
				message: `Failed to find a user with squarespace siteId ${websiteId}`
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
