require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../models");

router.post('/', async (req, res) => {
	try {
	    const { email, password } = req.body;
		const user = await db.User.findOne({email})
		console.log(user)
		// decrypt password in db and check if matches input
		const isMatch = await user.comparePassword(password)
		isMatch ? res.status(200).json({
			message: 'SUCCESS',
			token: user.apiKey
		}) : res.status(401).json({
			status: 401,
			message: "Password is incorrect"
		})
	} catch (err) {
	    console.error(err)
		if (err.code === 11000) {
			res.status(404).json({
				status: 404,
				message: "Invalid credentials, no user found with that email address"
			})
		}
		res.status(400).json({
			status: 400,
			message: err.message
		})
	}
})

module.exports = router;