const mongoose = require('mongoose');

exports.pointSchema = new mongoose.Schema({
	type: {
		type: String,
		enum: ['Point'],
		required: true,
		default: 'Point'
	},
	coordinates: {
		type: [Number],
		required: false,
	}
});