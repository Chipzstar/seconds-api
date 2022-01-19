// twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const TwilioClient = require('twilio')(accountSid, authToken, {
	logLevel: 'debug'
});

const sendSMS = async (phone, template) => {
	try {
		let sender = process.env.TWILIO_SERVICE_NUMBER
		process.env.NODE_ENV === 'production' && await TwilioClient.messages.create({
			body: template,
			from: sender,
			to: phone
		});
		return true
	} catch (err) {
		console.error(err);
		throw err;
	}
}

module.exports = sendSMS