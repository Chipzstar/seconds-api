const mongoose = require("mongoose");

const deliverySchema = new mongoose.Schema({
	description: {
		type: String,
	},
	itemsCount: {
		type: mongoose.Schema.Types.Number,
	},
	value: {
		type: mongoose.Schema.Types.Decimal128,
		default: null
	},
	orderReference: {
		type: String
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
		firstName: "",
		lastName: "",
		email: "",
		phoneNumber: "",
		businessName: "",
		instructions: ""
	}
})

module.exports = deliverySchema;