require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../models");

router.post('/', async (req, res) => {
	try {
	    const { email, password } = req.body;
		const user = await db.User.findOne({email})
		if (user) {
			// decrypt password in db and check if matches input
			const isMatch = await user.comparePassword(password)
			isMatch ? res.status(200).json({
				message: 'SUCCESS',
				token: user.apiKey
			}) : res.status(401).json({
				status: 401,
				message: "Password is incorrect"
			})
		} else {
			res.status(404).json({
				status: 404,
				message: "No user found with that email address"
			})
		}
	} catch (err) {
	    console.error(err)
		res.status(400).json({
			status: 400,
			message: 'Bad request. Email or password is missing'
		})
	}
})

module.exports = router;