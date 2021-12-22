const mongoose = require('mongoose');
const pointSchema = require('./pointSchema');

const addressSchema = new mongoose.Schema({
	street: {
		type: String,
		default: ''
	},
	city: {
		type: String,
		default: ''
	},
	postcode: {
		type: String,
		default: ''
	},
	countryCode: {
		type: String,
		default: 'GB'
	},
	geolocation: {
		type: pointSchema,
		index: '2dsphere'
	}
}, {_id: false});

module.exports = addressSchema;