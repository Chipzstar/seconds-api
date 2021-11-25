const axios = require('axios');

async function authStreetStream() {
	const authURL = `${process.env.STREET_STREAM_ENV}/api/tokens`;
	const payload = {
		email: 'secondsdelivery@gmail.com',
		authType: 'CUSTOMER',
		password: process.env.STREET_STREAM_PASSWORD
	};
	let res = (await axios.post(authURL, payload)).headers;
	return res.authorization.split(' ')[1];
}

module.exports = { authStreetStream }