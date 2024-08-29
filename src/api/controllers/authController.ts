import { Request, Response, NextFunction, CookieOptions } from "express";
// const { v4: uuidv4 } = require("uuid");
import { v4 as uuidv4 } from "uuid";
import { generateTokens } from "../utils/jwt";
import {
  addRefreshTokenToWhitelist,
  deleteRefreshToken,
  findRefreshTokenById,
} from "../services/authServices";
import {
  CreateUser,
  findUserByEmail,
  findUserById,
} from "../services/userServices";
import { UserInterface } from "../interfaces/userInterface";
import bcrypt from "bcrypt";
import { hashToken } from "../utils/hashToken";
const jwt = require("jsonwebtoken");

async function signUpUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "You must provide an email and a password." });
    }

    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      return res.status(400).json({ error: "Email already in use." });
    }

    const user = await CreateUser({
      email,
      password,
    } as UserInterface);

    const jti = uuidv4();
    const { accessToken, refreshToken } = generateTokens(
      {
        id: user.createdUser.id,
        email: user.createdUser.email,
        password: user.createdUser.password,
      },
      jti
    );

    await addRefreshTokenToWhitelist({
      jti,
      refreshToken,
      userId: user.createdUser.id,
    });

    res.json({
      message: "User created successfully",
      accessToken,
      refreshToken,
    });
  } catch (err: any) {
    next(err);
  }
}

async function loginUser(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "You must provide an email and a password." });
    }

    const existingUser = await findUserByEmail(email);

    if (!existingUser) {
      return res.status(403).json({ error: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, existingUser.password);
    if (!validPassword) {
      return res.status(403).json({ error: "Invalid login credentials." });
    }

    const jti = uuidv4();
    const { accessToken, refreshToken } = generateTokens(existingUser, jti);
    await addRefreshTokenToWhitelist({
      jti,
      refreshToken,
      userId: existingUser.id,
    });

    // Set the access token and refresh token cookies with the HttpOnly flag
    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    };

    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, cookieOptions);

    res.json({
      message: "Logged in successfully.",
      accessToken,
      refreshToken,
    });
  } catch (err: any) {
    next(err);
  }
}

async function logOutUser(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ error: "Missing refresh token." });
    }

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!);
    console.log("JWT Payload:", payload);

    // Delete based on jti from payload
    await deleteRefreshToken(payload.jti); // Use jti for deletion

    // Set the access token and refresh token cookies with the HttpOnly flag
    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    };

    // Clear cookies with appropriate options
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    res.json({ message: "Logged out." });
  } catch (err) {
    console.error("Logout error:", err);
    next(err);
  }
}

async function getRefreshToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(400).json({ error: "Missing refresh token." });
    }
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!);
    console.log("JWT Payload:", payload);
    const savedRefreshToken = await findRefreshTokenById(payload.jti);
    console.log("Retrieved refresh token:", savedRefreshToken);

    if (!savedRefreshToken) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Refresh token not found." });
    }

    const hashedToken = hashToken(refreshToken);
    console.log("Hashed token:", hashedToken);
    console.log("Saved hashed token:", savedRefreshToken.hashedToken);

    if (hashedToken !== savedRefreshToken.hashedToken) {
      res.status(401).json({ error: "Unauthorized hashedToken not match!" });
      throw new Error("Unauthorized hashedToken not match!");
      // .json({ error: "Unauthorized hashedToken not match!" });
    }

    const user = await findUserById(payload.userId);
    if (!user) {
      res.status(401);
      throw new Error("User not found");
    }

    await deleteRefreshToken(savedRefreshToken.id);

    const jti = uuidv4();
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      user,
      jti
    );
    await addRefreshTokenToWhitelist({
      jti,
      refreshToken: newRefreshToken,
      userId: user.id,
    });

    // Set the access token and refresh token cookies with the HttpOnly flag
    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    };

    // Set the access token and refresh token cookies with the HttpOnly flag
    res.cookie("accessToken", accessToken, cookieOptions);
    res.cookie("refreshToken", refreshToken, cookieOptions);

    res.json({
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    next(err);
  }
}

export default {
  signUpUser,
  loginUser,
  logOutUser,
  getRefreshToken,
};
