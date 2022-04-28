const MagicBellClient = require('@magicbell/core').default;
const { Notification } = require('@magicbell/core');

MagicBellClient.configure({ apiKey: process.env.MAGIC_BELL_API_KEY, apiSecret: process.env.MAGIC_BELL_SECRET_KEY });

const sendNotification = async (external_id, title, content, category) => {
	try {
		const notification = external_id ? await Notification.create({
			category,
			title,
			content,
			recipients: [{ external_id }]
		}) : "No External ID!";
		console.log(notification);
	} catch (err) {
		console.error(err);
		throw err
	}
};

module.exports = sendNotification;