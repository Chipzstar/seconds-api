const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { Schema } = require('mongoose');
const crypto = require('crypto');
const moment = require('moment');
const { deliveryHoursSchema } = require('./deliveryHours');

const userSchema = new mongoose.Schema({
	email: {
		type: String,
		required: true,
		unique: true
	},
	firstname: {
		type: String,
		required: true
	},
	lastname: {
		type: String,
		required: true
	},
	company: {
		type: String,
		required: true
	},
	phone: {
		type: String,
		required: true
	},
	fullAddress: {
		type: String,
		required: true
	},
	team: {
		type: Array,
		default: []
	},
	address: {
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
		}
	},
	password: {
		type: String,
		required: true
	},
	passwordResetToken: {
		type: String
	},
	passwordResetExpires: {
		type: Date
	},
	profileImage: {
		filename: {
			type: String,
			default: ''
		},
		location: {
			type: String,
			default: ''
		}
	},
	shopify: {
		products: [],
		shopId: String,
		shopOwner: String,
		country: String,
		domain: String,
		baseURL: String,
		accessToken: String
	},
	square: {
		shopId: String,
		shopName: String,
		domain: String,
		country: String,
		clientId: String,
		clientSecret: String,
		accessToken: String
	},
	createdAt: {
		type: Date,
		default: Date.now()
	},
	apiKey: {
		type: String,
		default: ''
	},
	stripeCustomerId: {
		type: String,
		default: ''
	},
	paymentMethodId: {
		type: String,
		default: ''
	},
	subscriptionId: {
		type: String,
		default: ''
	},
	subscriptionPlan: {
		type: String,
		default: ''
	},
	selectionStrategy: {
		type: String,
		default: 'eta'
	},
	deliveryHours: {
		type: deliveryHoursSchema,
		required: true,
		default: {
			1: {
				open: {
					h: 7,
					m: 0
				},
				close: {
					h: 18,
					m: 0
				},
				canDeliver: true
			},
			2: {
				open: {
					h: 7,
					m: 0
				},
				close: {
					h: 18,
					m: 0
				},
				canDeliver: true
			},
			3: {
				open: {
					h: 7,
					m: 0
				},
				close: {
					h: 18,
					m: 0
				},
				canDeliver: true
			},
			4: {
				open: {
					h: 7,
					m: 0
				},
				close: {
					h: 18,
					m: 0
				},
				canDeliver: true
			},
			5: {
				open: {
					h: 7,
					m: 0
				},
				close: {
					h: 18,
					m: 0
				},
				canDeliver: true
			},
			6: {
				open: {
					h: 7,
					m: 0
				},
				close: {
					h: 18,
					m: 0
				},
				canDeliver: true
			},
			0: {
				open: {
					h: 10,
					m: 0
				},
				close: {
					h: 16,
					m: 0
				},
				canDeliver: true
			}
		}
	},
	jobs: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
	subscriptionItems: {
		standardMonthly: "",
		standardCommission: "",
		multiDropCommission: ""
	},
});

userSchema.pre('save', async function (next) {
	try {
		if (!this.isModified('password')) {
			return next();
		}
		this.password = await bcrypt.hash(this.password, 10);
		return next();
	} catch (err) {
		return next(err);
	}
});

userSchema.methods.comparePassword = async function (candidatePassword, next) {
	try {
		return await bcrypt.compare(candidatePassword, this.password);
	} catch (err) {
		console.error(err);
		return next(err);
	}
};

userSchema.methods.createPasswordResetToken = function () {
	const resetToken = crypto.randomBytes(32).toString('hex');
	this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');

	console.log({ resetToken }, this.passwordResetToken);

	this.passwordResetExpires = moment().add(1, 'day');
	return resetToken;
};

const User = mongoose.model('User', userSchema);

module.exports = User;