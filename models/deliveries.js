const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema({
	id: {
		type: String,
		required: true
	},
	orderReference: {
		type: String,
		required: true
	},
	description: {
		type: String,
	},
	transport: {
		type: String,
	},
	dropoffStartTime: {
		type: Date,
		required: false,
	},
	dropoffEndTime: {
		type: Date,
		required: false,
	},
	dropoffLocation: {
		fullAddress: "",
		streetAddress: "",
		city: "",
		postcode: "",
		latitude: 0,
		longitude: 0,
		firstName: "",
		lastName: "",
		email: "",
		phoneNumber: "",
		businessName: "",
		instructions: ""
	},
	trackingURL: {
		type: String
	},
	status: {
		type: String
	}
}, {_id: false})

module.exports = deliverySchema;