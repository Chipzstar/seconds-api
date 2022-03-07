// twilio client
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const TwilioClient = require('twilio')(accountSid, authToken, {
	logLevel: 'debug'
});
const PNF = require('google-libphonenumber').PhoneNumberFormat
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance()

const sendSMS = async (phone, template, { smsCommission }, smsEnabled = false, alphaSender = 'Seconds') => {
	try {
		const sender = alphaSender ? alphaSender : process.env.TWILIO_SERVICE_NUMBER;
		const number = phoneUtil.parseAndKeepRawInput(phone, 'GB');
		const E164Number = phoneUtil.format(number, PNF.E164);
		console.log('E164 Phone Number:', E164Number);
		if (process.env.TWILIO_STATUS === 'active' && smsEnabled) {
			const result = await TwilioClient.messages.create({
				body: template,
				from: sender,
				to: E164Number
			});
			// increment usage count for SMS on next subscription invoice
			if (result) {
				const usageRecord = await stripe.subscriptionItems.createUsageRecord(smsCommission, {
					quantity: 1,
					action: 'increment',
					timestamp: Math.ceil(Date.now() / 1000)
				});
				console.log(usageRecord);
				return 'SMS sent successfully!';
			} else {
				return 'Twilio could send the message to' + phone;
			}
		} else {
			return 'SMS not enabled for this account';
		}
	} catch (err) {
		console.error(err);
		throw err;
	}
};

module.exports = sendSMS