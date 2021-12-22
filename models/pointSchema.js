const mongoose = require('mongoose');

exports.pointSchema = new mongoose.Schema({
	type: {
		type: String,
		enum: ['Point'],
		required: true
	},
	coordinates: {
		type: [Number],
		required: false
	}
}, {_id: false});