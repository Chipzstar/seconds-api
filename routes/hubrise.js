const express = require('express')
const db = require('../models');
const { createEcommerceJob, convertWeightToVehicleCode, geocodeAddress, genOrderReference } = require('../helpers');
const moment = require('moment');
const sendEmail = require('../services/email');
const router = express.Router()

async function sumProductWeights(items, user){
	const all_catalogs = await db.Catalog.find({})
	console.log("CATALOGS:", all_catalogs)
	console.log("------------------------------------------------------------------")
	const catalog = await db.Catalog.findOne({ clientId: user['_id'] })
	console.log(catalog)
	console.log("------------------------------------------------------------------")
	let totalWeight;
	for (let item of items){
		catalog['products'].forEach(({ variants }) => {
			variants.forEach(({ ref, weight }) => {
				if (ref === item.sku_ref) {
					totalWeight += weight
				}
			})
		});
	}
	return totalWeight
}

async function generatePayload(order, user) {
	try {
		console.log('************************************');
		console.log(order);
		console.log('************************************');
		const packageDescription = order.items.map(item => item['product_name']).join('\n');
		const totalWeight = await sumProductWeights(order.items, user)
		const vehicleType = convertWeightToVehicleCode(totalWeight).vehicleCode;
		console.log('DETAILS');
		console.table({ vehicleType });
		console.log(packageDescription);
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.customer['address_1']} ${order.customer['address_2']} ${order.customer['city']} ${order.customer['postal_code']}`
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
			itemsCount: order.items.length,
			vehicleType,
			parcelWeight: order['total_weight'] / 1000,
			drops: [
				{
					dropoffAddress: `${order.customer['address_1']} ${order.customer['address_2']} ${order.customer['city']} ${order.customer['postal_code']}`,
					dropoffAddressLine1: order.customer['address_1'],
					dropoffAddressLine2: order.customer['address_2'],
					dropoffCity: order.customer['city']
						? order.customer['city']
						: formattedAddress.city,
					dropoffPostcode: order.customer['postal_code']
						? order.customer['postal_code']
						: formattedAddress.postcode,
					dropoffLongitude: formattedAddress.longitude,
					dropoffLatitude: formattedAddress.latitude,
					dropoffPhoneNumber: order.customer.phone ? order.customer.phone : '+447523958055',
					dropoffEmailAddress: order.email ? order.email : order.customer.email,
					dropoffBusinessName: order.customer.company_name ? order.customer.company_name : '',
					dropoffFirstName: order.customer.first_name,
					dropoffLastName: order.customer.last_name,
					dropoffInstructions: order['customer_notes'] ? order['customer_notes'] : '',
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
			subject: `Failed Hubrise order #${order['order_id']}`,
			html: `<div><p>Order Id: #${order['order_id']}</p><p>Hubrise Account: ${user.hubrise.accountName} - ${user.hubrise.locationId}<br/></p><p>Job could not be created. <br/>Reason: ${err.message}</p></div>`
		});
		console.error(err);
		return err;
	}
}

router.post('/', async (req, res) => {
	try {
		// filter the request topic and shop domain
		const agent = req.headers['user-agent'];
		const { resource_type, event_type } = req.body;
		console.table({ agent });
		if (resource_type === 'order' && event_type === 'create') {
			console.log('-----------------------------');
			console.log('ORDER ID:');
			console.log(req.body['order_id']);
			console.log('-----------------------------');
			// check that the shop domain belongs to a user
			const user = await db.User.findOne({ 'hubrise.locationId': req.body['location_id'] });
			console.log('User Found:', !!user);
			if (user) {
				// CHECK if the incoming delivery is a local delivery
				const isLocalDelivery = req.body['new_state']['service_type'] === 'delivery'
				const isSubscribed = !!user.subscriptionId & !!user.subscriptionPlan;
				console.log('isLocalDelivery:', isLocalDelivery);
				if (isLocalDelivery) {
					if (isSubscribed) {
						generatePayload(req.body['new_state'], user)
							.then(payload => {
								const ids = { hubriseId: req.body['order_id'] };
								createEcommerceJob("Hubrise", req.body['order_id'], payload, ids, user, req.body['location_id']).then(() => console.log("SUCCESS"));
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
						message: 'Seconds can only fulfill orders that require local delivery'
					});
				}
			} else {
				res.status(200).json({
					success: false,
					status: 'USER_NOT_FOUND',
					message: `Failed to find a user with hubrise location ${req.body['location_id']}`
				});
			}
		} else {
			res.status(200).json({
				success: false,
				status: 'UNKNOWN_TOPIC',
				message: `Webhook topic ${resource_type}/${event_type} is not recognised`
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
})


module.exports = router;