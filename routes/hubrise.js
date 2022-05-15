const express = require('express');
const db = require('../models');
const createEcommerceJob = require('../services/ecommerce');
const {
	convertWeightToVehicleCode,
	geocodeAddress,
	genOrderReference,
	cancelOrder,
	checkPickupHours,
	setNextDayDeliveryTime
} = require('../helpers');
const moment = require('moment');
const sendEmail = require('../services/email');
const { HUBRISE_STATUS, PLATFORMS, STATUS } = require('@seconds-technologies/database_schemas/constants');
const { SERVICE_TYPE } = require('../constants/hubrise');
const router = express.Router();

function validateOrderTriggers(triggers, order) {
	console.log('-----------------------------------------------');
	console.log(triggers);
	console.log('-----------------------------------------------');
	let isSTRValid = false;
	let isStatusValid = false;
	const isDelivery = order['service_type'] === SERVICE_TYPE.DELIVERY;
	// check if both service type refs and order statuses triggers are empty, return false
	if (!triggers.statuses.length && !triggers.serviceTypeRefs.length) {
		return false;
	}
	// CHECK SERVICE TYPE REF (STR)
	if (triggers.serviceTypeRefs.length) {
		console.log('************************************************');
		// get current serviceTypeRef
		const currSTR = order['service_type_ref'];
		console.log(currSTR);
		// check if current order STR is listed in the triggers
		if (triggers.serviceTypeRefs.includes(currSTR)) {
			isSTRValid = true;
		}
		console.log('STR valid:', isSTRValid);
		console.log('************************************************');
	}
	// CHECK ORDER STATUS
	if (triggers.statuses.length) {
		console.log('************************************************');
		// get current order status
		const currStatus = order['status'];
		console.log(currStatus);
		// check if current order STATUS is listed in the triggers
		if (triggers.statuses.includes(currStatus)) {
			isStatusValid = true;
		}
		console.log('Status valid:', isStatusValid);
		console.log('************************************************');
	}
	return isSTRValid && isStatusValid && isDelivery;
}

async function sumProductWeights(items, user) {
	console.log('------------------------------------------------------------------');
	const catalog = await db.Catalog.findOne({ clientId: user['_id'] });
	console.log('------------------------------------------------------------------');
	let totalWeight = 0;
	if (catalog) {
		for (let item of items) {
			catalog['products'].forEach(({ variants }) => {
				variants.forEach(({ ref, weight }, index) => {
					if (ref === item.sku_ref) {
						totalWeight += weight * Number(item.quantity);
					}
				});
			});
		}
	}
	return totalWeight;
}

async function generatePayload(order, user, settings) {
	try {
		console.log('************************************');
		console.log(order);
		console.log('************************************');
		const packageDescription = order.items.map(item => item['product_name']).join('\n');
		const totalWeight = await sumProductWeights(order.items, user);
		const vehicleType = convertWeightToVehicleCode(totalWeight).vehicleCode;
		console.log('DETAILS');
		console.table({ vehicleType });
		console.log(packageDescription);
		// geocode dropoff address
		const { formattedAddress, fullAddress } = await geocodeAddress(
			`${order.customer['address_1']} ${order.customer['address_2']} ${order.customer['city']} ${order.customer['postal_code']}`
		);
		console.log('Geocoded results');
		const geolocation = user.address.geolocation.toObject();
		// sets ON_DEMAND_TIME_WINDOW as a default
		let packagePickupStartTime = moment().add(25, 'minutes').format();
		let packageDropoffEndTime = moment(packagePickupStartTime).add(2, 'hours').format();
		// check if order is scheduled with an expected time
		if (order['expected_time']) {
			const canDeliver = checkPickupHours(order['expected_time'], user.deliveryHours);
			if (!canDeliver) {
				const { nextDayPickup, nextDayDropoff } = setNextDayDeliveryTime(
					order['expected_time'],
					user.deliveryHours
				);
				console.table({ nextDayPickup, nextDayDropoff });
				packagePickupStartTime = nextDayPickup;
				packageDropoffEndTime = moment(nextDayPickup).clone().add(2, 'hours');
			} else {
				// if order has an expected customer time, set as the dropoff deadline
				packageDropoffEndTime = moment(order['expected_time']).format();
			}
		}
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
			packagePickupStartTime,
			packagePickupEndTime: undefined,
			packageDeliveryType: 'ON_DEMAND',
			itemsCount: order.items.length,
			vehicleType,
			parcelWeight: totalWeight,
			drops: [
				{
					dropoffAddress: `${order.customer['address_1']} ${order.customer['address_2']} ${order.customer['city']} ${order.customer['postal_code']}`,
					dropoffAddressLine1: order.customer['address_1'],
					dropoffAddressLine2: order.customer['address_2'] ? order.customer['address_2'] : '',
					dropoffCity: order.customer['city'] ? order.customer['city'] : formattedAddress.city,
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
					dropoffInstructions: order['customer_notes']
						? order['customer_notes']
						: order.customer['delivery_notes']
						? order.customer['delivery_notes']
						: '',
					packageDropoffEndTime,
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
		if (resource_type === 'order') {
			console.log('-----------------------------');
			console.log('ORDER ID:');
			console.log(req.body['order_id']);
			console.log('-----------------------------');
			// check that the locationId belongs to a hubrise user
			const hubrise = await db.Hubrise.findOne({ locationId: req.body['location_id'] });
			console.log('Hubrise Account Found:', !!hubrise);
			if (hubrise) {
				const user = await db.User.findById(hubrise['clientId']);
				const settings = await db.Settings.findOne({ clientId: user['_id'] });
				// check that the platform integration is active for that user
				const isActive = hubrise['active'];
				console.log('isActive:', isActive);
				if (isActive) {
					// check if hubrise account has set up order triggers, check if order contains any listed service type refs / order statuses
					const { triggers } = hubrise['options'];
					let canDeliver = req.body['service_type'] === SERVICE_TYPE.DELIVERY;
					if (triggers.enabled) {
						canDeliver = validateOrderTriggers(triggers, req.body['new_state']);
					}
					if (canDeliver) {
						// check if user has an active subscription
						const isSubscribed = !!user['subscriptionId'] & !!user['subscriptionPlan'];
						if (isSubscribed) {
							// check to see if the hubrise orderId already exists in the system
							const job = await db.Job.findOne({
								'jobSpecification.hubriseId': req.body['order_id']
							});
							// condition for creating orders from order.create event type
							const validCreate = event_type === 'create'
							// condition for creating orders from order.update event type
							const validUpdate = event_type === 'update' && triggers.enabled && validateOrderTriggers(triggers, req.body['new_state']) && !job
							// check the event type of the order
							if (validCreate || validUpdate) {
								generatePayload(req.body['new_state'], user, settings)
									.then(payload => {
										const ids = { hubriseId: req.body['order_id'] };
										createEcommerceJob(
											PLATFORMS.HUBRISE,
											req.body['order_id'],
											payload,
											ids,
											user,
											settings,
											req.body['location_id']
										).then(job => {
											// send Alert to businesses when expected time can not be met
											let order = req.body['new_state'];
											let expectedTime = req.body['new_state']['expected_time'];
											let actualTime = job['jobSpecification'].deliveries[0].dropoffEndTime;
											console.table({ expectedTime, actualTime });
											if (expectedTime && moment(actualTime).isAfter(moment(expectedTime))) {
												sendEmail({
													name: `${user.firstname} ${user.lastname}`,
													email: user.email,
													subject: `Delivery Alert - Order ${req.body['order_id']}`,
													html: `<div>
															<h3>The following order may not be delivered on time. See details below:</h3>
															<br/>
															<span>Hubrise Order Id: ${req.body['order_id']}</span>
															<span>Customer: ${order.customer.first_name} ${order.customer.last_name}</span>
															<span>Address: ${order.customer['address_1']} ${order.customer['address_2']} ${order.customer['city']} ${
														order.customer['postal_code']
													}</span>
															<span>Expected delivery time: <strong>${moment(expectedTime).calendar()}</strong></span>
															<span>Actual delivery time: <strong>${moment(actualTime).calendar()}</strong></span>
															</div>`
												})
													.then(() => console.log('Hubrise Alert Sent Successfully!'))
													.catch(err =>
														console.log('Failed to send email alert!', err.message)
													);
											}
											console.log('SUCCESS');
										});
									})
									.catch(err => console.error(err));
								res.status(200).json({
									success: true,
									status: 'DELIVERY_JOB_CREATED',
									message: 'webhook received'
								});
							} else if (event_type === 'update') {
								// cancel order on system if order update event is one of the 3 order cancellation statuses
								if (
									[
										HUBRISE_STATUS.CANCELLED,
										HUBRISE_STATUS.DELIVERY_FAILED,
										HUBRISE_STATUS.REJECTED
									].includes(req.body['new_state']['status'])
								) {
									if (job) {
										let jobId = job['jobSpecification'].id;
										let provider = job['selectedConfiguration'].providerId;
										cancelOrder(jobId, provider, job)
											.then(message => {
												job.status = STATUS.CANCELLED;
												job.save();
												console.log(message);
											})
											.catch(err => {
												console.error(err);
												sendEmail({
													email: 'chipzstar.dev@gmail.com',
													name: 'Chisom Oguibe',
													subject: `Hubrise order #${req.body['order_id']} could not be cancelled`,
													html: `<div><p>Order Id: #${req.body['order_id']}</p><p>Hubrise Account: ${hubrise['accountName']} - ${hubrise['locationId']}<br/></p><p>Job could not be cancelled. <br/>Reason: ${err.message}</p></div>`
												});
											});
										res.status(200).json({
											success: true,
											status: 'DELIVERY_JOB_UPDATED',
											message: 'webhook received'
										});
									} else {
										res.status(200).json({
											success: false,
											status: 'JOB_DOES_NOT_EXIST',
											message: `A job with hubrise orderId ${req.body['order_id']} does not exist`
										});
									}
								} else {
									res.status(200).json({
										success: true,
										status: 'ORDER_STATUS_NOT_HANDLED',
										message: `${req.body['new_state']['status']} is not a status that needs to be handled`
									});
								}
							}
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
						status: 'INACTIVE_INTEGRATION_STATUS',
						message: `The user has disabled this platform integration`
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
});

module.exports = router;
