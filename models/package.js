const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema({
	description: {
		type: "string",
	},
	dropoffLocation: {
		fullAddress: "",
		street_address: "",
		city: "",
		postcode: "",
		firstName: "",
		lastName: "",
		email: "",
		phoneNumber: "",
		businessName: "",
		instructions: ""
	},
	pickupLocation: {
		fullAddress: "",
		street_address: "",
		city: "",
		postcode: "",
		firstName: "",
		lastName: "",
		email: "",
		phoneNumber: "",
		businessName: "",
		instructions: ""
	},
	pickupStartTime: {
		type: Date
	},
	dropoffStartTime: {
		type: Date
	},
	pickupEndTime: {
		type: Date
	},
	dropoffEndTime: {
		type: Date
	},
	itemsCount: {
		type: mongoose.Schema.Types.Number,
	},
	value: {
		type: mongoose.Schema.Types.Decimal128,
	}
})

module.exports = packageSchema;