// twilio client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const TwilioClient = require('twilio')(accountSid, authToken, {
	logLevel: 'debug'
});
const PNF = require('google-libphonenumber').PhoneNumberFormat
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance()

const sendSMS = async (phone, template) => {
	try {
		let sender = process.env.TWILIO_SERVICE_NUMBER
		const number = phoneUtil.parseAndKeepRawInput(phone, 'GB');
		const E164Number = phoneUtil.format(number, PNF.E164)
		// console.log("E164 Phone Number:", E164Number)
		process.env.TWILIO_STATUS === 'active' && await TwilioClient.messages.create({
			body: template,
			from: sender,
			to: E164Number
		});
		return true
	} catch (err) {
		console.error(err);
		throw err;
	}
}

module.exports = sendSMS