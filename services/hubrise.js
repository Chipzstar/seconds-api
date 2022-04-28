const sendEmail = require('./email');
const axios = require('axios');

async function sendHubriseStatusUpdate(hubriseStatus, orderId, credentials, type="Hubrise status update"){
	try {
		const endpoint = `/locations/${credentials.locationId}/orders/${orderId}`;
		const URL = process.env.HUBRISE_API_URL + endpoint
		const config = {
			headers: {
				'X-ACCESS-TOKEN': credentials.accessToken
			}
		}
		const response = (await axios.patch(URL, { status: hubriseStatus }, config)).data;
		console.log('-----------------------------------------------');
		console.log(response)
		console.log('-----------------------------------------------');
		return true
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

module.exports = sendHubriseStatusUpdate;