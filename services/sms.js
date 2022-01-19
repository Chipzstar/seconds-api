// twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const TwilioClient = require('twilio')(accountSid, authToken, {
	logLevel: 'debug'
});

const sendSMS = async (phone, template, sender='+19362462775') => {
	try {
		const res = await TwilioClient.messages.create({
			body: template,
			from: sender,
			to: phone
		});
		console.log('******************************************');
		console.log(res);
		console.log('******************************************');
	} catch (err) {
		console.error(err);
		throw err;
	}
}

module.exports = sendSMS