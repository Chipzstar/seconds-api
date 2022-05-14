const sendEmail = require('./email');
const axios = require('axios');
const moment = require('moment');

async function sendHubriseStatusUpdate(hubriseStatus, orderId, credentials, type="Hubrise STATUS update"){
	try {
		const endpoint = `/locations/${credentials.locationId}/orders/${orderId}`;
		const URL = process.env.HUBRISE_API_BASE_URL + endpoint
		console.log("URL:", URL)
		const config = {
			headers: {
				'X-ACCESS-TOKEN': credentials.accessToken
			}
		}
		const response = (await axios.patch(URL, { status: hubriseStatus }, config)).data;
		console.log('-----------------------------------------------');
		console.table({ID: response.id, STATUS: response.status})
		console.log('-----------------------------------------------');
		return  `New order hubrise status: ${hubriseStatus}`
	} catch (err) {
		console.log('************************************************');
		console.error(err);
		console.log('************************************************');
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed ${type} order #${orderId}`,
			html: `<div><p>OrderId: ${orderId}</p><p>${type} Location ID: ${credentials.locationId}</p><p>Job status could not be updated.<br/>Reason: ${err.message}</p></div>`
		})
		return err
	}
}

async function sendHubriseEtaUpdate(newEta, deliveryInfo, orderId, credentials, type="Hubrise ETA update"){
	try {
		const endpoint = `/locations/${credentials.locationId}/orders/${orderId}`;
		const URL = process.env.HUBRISE_API_BASE_URL + endpoint
		console.log("URL:", URL)
		const config = {
			headers: {
				'X-ACCESS-TOKEN': credentials.accessToken
			}
		}
		const response = (await axios.patch(URL, {
			confirmed_time: moment(newEta).toISOString(),
			custom_fields: {
				delivery: {
					driver_pickup_time: deliveryInfo.pickupTime,
					tracking_url: deliveryInfo.trackingUrl,
					driver: {
						first_name: deliveryInfo.driverName,
						phone: deliveryInfo.driverPhone,
					}
				}
			}
		}, config)).data;
		console.log('-----------------------------------------------');
		console.table({ID: response.id, STATUS: response.status})
		console.log('-----------------------------------------------');
		return `Confirmed Time is now ${moment(newEta).toISOString()}`
	} catch (err) {
		console.log('************************************************');
		console.error(err);
		console.log('************************************************');
		await sendEmail({
			email: 'chipzstar.dev@gmail.com',
			name: 'Chisom Oguibe',
			subject: `Failed ${type} order #${orderId}`,
			html: `<div><p>OrderId: ${orderId}</p><p>${type} Location ID: ${credentials.locationId}</p><p>Job status could not be updated.<br/>Reason: ${err.message}</p></div>`
		})
		return err
	}
}

module.exports = { sendHubriseStatusUpdate, sendHubriseEtaUpdate } ;