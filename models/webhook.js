const mongoose = require('mongoose');
const { Schema } = require('mongoose');
const moment = require('moment');
const { VERSIONS, WEBHOOK_TOPICS } = require('../constants');

const topicValidator = topics => topics.every(topic => WEBHOOK_TOPICS.includes(topic));

const webhookSchema = new Schema({
	endpointURL: {
		type: String,
		required: true
	},
	clientId: {
		type: mongoose.Schema.Types.ObjectId,
		required: true
	},
	lastUsed: {
		type: Date,
		required: true,
		default: moment().toISOString(true)
	},
	isBroken: {
		type: String,
		required: true,
		default: false
	},
	apiVersion: {
		type: String,
		enum: VERSIONS
	},
	secret: {
		type: String,
		required: true
	},
	topics: {
		type: [String],
		validate: [
			{
				validator: val => !!Array.isArray(val),
				msg: '{VALUE} is not an array'
			},
			{
				validator: topicValidator,
				msg: '{VALUE} is not a supported topic'
			}
		]
	}
});

const Webhook = mongoose.model('Webhook', webhookSchema);

module.exports = Webhook;
