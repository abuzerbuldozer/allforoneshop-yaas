/**
 * [y] hybris Platform
 *
 * Copyright (c) 2000-2015 hybris AG
 * All rights reserved.
 *
 * This software is the confidential and proprietary information of hybris
 * ("Confidential Information"). You shall not disclose such Confidential
 * Information and shall use it only in accordance with the terms of the
 * license agreement you entered into with hybris.
 */

'use strict';

angular.module('ds.checkout')
     /** The checkout service provides functions to pre-validate the credit card through Stripe,
      * and to create an order.
      */
    .factory('CheckoutSvc', ['CheckoutREST', 'OrdersREST', 'TokenSvc', 'ProductSvc', 'StripeJS', 'CartSvc', 'AuthREST', 'settings', '$q', 'GlobalData', 'CartREST',
        function (CheckoutREST, OrdersREST, TokenSvc, ProductSvc, StripeJS, CartSvc, AuthREST, settings, $q, GlobalData, CartREST) {

        /** CreditCard object prototype */
        var CreditCard = function () {
            this.number = null;
            this.cvc = null;
            this.expMonth = null;
            this.expYear = null;
        };

        /** Order prototype for start of checkout.*/
        var DefaultOrder = function (paymentId) {
            this.shipTo = {};
            this.billTo = {};
            this.billTo.country = 'US';

            /*if(paymentId == "paypal"){
                this.paymentMethods =[
                    {
                      provider:"paypal",
                      method:"PayPal"
                    }
                  ]
                this.payment = {
                    paymentId: paymentId,
                };
            }else{*/
                this.payment = {
                    paymentId: 'stripe',
                    customAttributes: {
                        token: ''
                    }
                };
            /*}
            if(paymentId != "paypal")*/
                this.creditCard = new CreditCard();
        };

        /** Error types to distinguish between Stripe validation and order submission errors
         * during checkout. */
        var ERROR_TYPES = {
            stripe: 'STRIPE_ERROR',
            paypal: 'PAYPAL_ERROR',
            order: 'ORDER_ERROR'
        };

        return {

            ERROR_TYPES: ERROR_TYPES,

            /** Returns a blank order for a clean checkout page.*/
            getDefaultOrder: function (paymentId) {
                return new DefaultOrder(paymentId);
            },

            /** Performs Stripe validation of the credit card, and if successful,
             * creates a new order.
             */
            checkout: function (order) {

                // the promise handle to the result of the transaction
                var deferred = $q.defer();
                var stripeData = {};
                /* jshint ignore:start */
                var creditCard = order.creditCard;
                stripeData.number = creditCard.number;
                stripeData.exp_month = creditCard.expMonth;
                stripeData.exp_year = creditCard.expYear;
                stripeData.cvc = creditCard.cvc;

                order.payment = {
                    paymentId: "stripe",
                    customAttributes: {
                        token: ''
                    }
                };
                /* jshint ignore:end */

                var self = this;
                try {

                    StripeJS.createToken(stripeData, function (status, response) {

                        if (response.error) {
                            deferred.reject({ type: ERROR_TYPES.stripe, error: response.error });
                        } else {
                            self.createOrder(order, response.id).then(
                                // success handler
                                function (order) {
                                    deferred.resolve(order);
                                },
                                // error handler
                                function(errorResponse){
                                    var errMsg = '';

                                    if(errorResponse.status === 500) {
                                        errMsg = 'Cannot process this order because the system is unavailable. Try again at a later time.';
                                    } else {
                                        errMsg = 'Order could not be processed.';
                                        if(errorResponse) {
                                            if(errorResponse.status) {
                                                errMsg += ' Status code: '+errorResponse.status+'.';
                                            }
                                            if(errorResponse.data && errorResponse.data.details && errorResponse.data.details.length) {
                                                angular.forEach(errorResponse.data.details, function (errorDetail) {
                                                    errMsg += ' ' + errorDetail.message;
                                                });
                                            }
                                        }
                                    }
                                    deferred.reject({ type: ERROR_TYPES.order, error: errMsg });
                                }
                            );
                        }
                    });
                }
                catch (error) {
                    console.error('Exception occurred during checkout: '+JSON.stringify(error));
                    error.type = 'payment_token_error';
                    deferred.reject({ type: ERROR_TYPES.stripe, error: error });
                }
                return deferred.promise;
            },


            /**
             * Issues a Orders 'save' (POST) on the order resource.
             * Uses the CartSvc to retrieve the current set of line items.
             * @param order
             * @param validated Stripe token
             * @return The result array as returned by Angular $resource.query().
             */
            createOrder: function(order, token) {
                var Order = function () {};
                var newOrder = new Order();
                newOrder.cartId = order && order.cart && order.cart.id ? order.cart.id : null;
                newOrder.payment = order.payment;
                newOrder.payment.customAttributes.token = token;
                newOrder.currency = order.cart.currency;
                if (order.shipping) {
                    newOrder.shipping = {
                        methodId: order.shipping.id,
                        amount: order.shipping.fee.amount,
                        zoneId: order.shipping.zoneId
                    };
                }

                newOrder.totalPrice =  order.cart.totalPrice.amount;
                newOrder.addresses = [];
                var billTo = {};
                billTo.contactName = order.billTo.contactName;
                billTo.companyName = order.billTo.companyName;
                billTo.street = order.billTo.address1;
                billTo.streetAppendix = order.billTo.address2;
                billTo.city = order.billTo.city;
                billTo.state = order.billTo.state;
                billTo.zipCode = order.billTo.zipCode;
                billTo.country = order.billTo.country;
                billTo.account = order.account.email;
                billTo.contactPhone = order.billTo.contactPhone;
                billTo.type = 'BILLING';
                newOrder.addresses.push(billTo);

                var shipTo = {};
                shipTo.contactName = order.shipTo.contactName;
                shipTo.companyName = order.shipTo.companyName;
                shipTo.street = order.shipTo.address1;
                shipTo.streetAppendix = order.shipTo.address2;
                shipTo.city = order.shipTo.city;
                shipTo.state = order.shipTo.state;
                shipTo.zipCode = order.shipTo.zipCode;
                shipTo.country = order.shipTo.country;
                shipTo.account = order.account.email;
                shipTo.contactPhone = order.shipTo.contactPhone;
                shipTo.type = 'SHIPPING';
                newOrder.addresses.push(shipTo);

                newOrder.customer = {};
                newOrder.customer.id = order.cart.customerId;
                if (order.account.title && order.account.title !== '') {
                    newOrder.customer.title = order.account.title;
                }
                if (order.account.firstName && order.account.firstName !== '') {
                    newOrder.customer.firstName = order.account.firstName;
                }
                if (order.account.middleName && order.account.middleName !== '') {
                    newOrder.customer.middleName = order.account.middleName;
                }
                if (order.account.lastName && order.account.lastName !== '') {
                    newOrder.customer.lastName = order.account.lastName;
                }
                newOrder.customer.email = order.account.email;

                // Will be submitted as "hybris-user" request header
                settings.hybrisUser = order.account.email;
                return CheckoutREST.Checkout.all('checkouts').all('order').post(newOrder);
            },


            /** Returns the shipping costs for this tenant.  If no cost found, it will be set to zero.
             */
            getShippingCost: function() {
                var deferred = $q.defer();

                var defaultCost = {};
                defaultCost.price = {};
                defaultCost.price[GlobalData.getCurrencyId()] = 0;
                
                CheckoutREST.ShippingCosts.all('shippingcosts').getList().then(function(shippingCosts){
                    var costs = shippingCosts.length && shippingCosts[0].price ? shippingCosts[0].plain() : defaultCost;
                    deferred.resolve(costs);
                }, function(failure){
                    if (failure.status === 404) {
                        deferred.resolve(defaultCost);
                    } else {
                        deferred.reject(failure);
                    }
                });

                return deferred.promise;
            },


            checkoutWithPaypalSrv : function(cart){
                var paypalValues = {
                    "clientId": settings.clientPaypalKey,
                    "clientSecretId": settings.clientPaypalSecret,
                    "mode": "sandbox",
                    "totalAmount": cart.totalPrice.amount,
                    "currency": cart.totalPrice.currency,
                    "successUrl": settings.pageUrl + "/#!/success?cartId="+cart.id,
                    "cancelUrl": settings.pageUrl + "/#!/cancel"
                };
                            
                CheckoutREST.CheckoutWithPaypal.all('pay').customPOST(paypalValues).then(function(result){
                    window.location.replace(result.redirectUrl);
                });
            },

            prepareForSuccessTheCheckoutWithPaypal : function(paymentId, payerId, token){
                var result = CheckoutREST.CheckoutWithPaypal.one('pay').one("paymentId", paymentId).one("payerId", payerId).one("client", settings.clientPaypalKey)
                .get().then();
                return token;
            },


            createOrderForPayPal: function(order, token) {
                var Order = function () {};
                var newOrder = new Order();
                order = angular.fromJson(order);
                newOrder.cartId = order && order.cart && order.cart.id ? order.cart.id : null;
                newOrder.payment = order.payment;
                //newOrder.payment.customAttributes.token = 'tk_1023498';
                newOrder.currency = order.cart.currency;
                if (order.shipping) {
                    newOrder.shipping = {
                        methodId: order.shipping.id,
                        amount: order.shipping.fee.amount,
                        zoneId: order.shipping.zoneId
                    };
                }

                newOrder.totalPrice =  order.cart.totalPrice.amount;
                newOrder.addresses = [];
                var billTo = {};
                billTo.contactName = order.shipTo.contactName;
                billTo.companyName = order.shipTo.companyName;
                billTo.street = order.shipTo.address1;
                billTo.streetAppendix = order.shipTo.address2;
                billTo.city = order.shipTo.city;
                billTo.state = order.shipTo.state;
                billTo.zipCode = order.shipTo.zipCode;
                billTo.country = order.shipTo.country;
                billTo.account = order.account.email;
                billTo.contactPhone = order.shipTo.contactPhone;
                billTo.type = 'BILLING';
                newOrder.addresses.push(billTo);

                var shipTo = {};
                shipTo.contactName = order.shipTo.contactName;
                shipTo.companyName = order.shipTo.companyName;
                shipTo.street = order.shipTo.address1;
                shipTo.streetAppendix = order.shipTo.address2;
                shipTo.city = order.shipTo.city;
                shipTo.state = order.shipTo.state;
                shipTo.zipCode = order.shipTo.zipCode;
                shipTo.country = order.shipTo.country;
                shipTo.account = order.account.email;
                shipTo.contactPhone = order.shipTo.contactPhone;
                shipTo.type = 'SHIPPING';
                newOrder.addresses.push(shipTo);

                newOrder.customer = {};
                newOrder.customer.id = order.cart.customerId;
                if (order.account.title && order.account.title !== '') {
                    newOrder.customer.title = order.account.title;
                }
                if (order.account.firstName && order.account.firstName !== '') {
                    newOrder.customer.firstName = order.account.firstName;
                }
                if (order.account.middleName && order.account.middleName !== '') {
                    newOrder.customer.middleName = order.account.middleName;
                }
                if (order.account.lastName && order.account.lastName !== '') {
                    newOrder.customer.lastName = order.account.lastName;
                }
                newOrder.customer.email = order.account.email;

                // Will be submitted as "hybris-user" request header
                settings.hybrisUser = order.account.email;
                
                 return OrdersREST.Orders.all('orders').post(newOrder);
                //return CheckoutREST.Checkout.all('checkouts').all('order').post(newOrder);
            },

            newCreateOrderForPayPal: function(order, token) {
                var self = this;
                var Order = function () {};
                var newOrder = new Order();
                order = angular.fromJson(sessionStorage.getItem("orderForPaypal"));
                var cartX = angular.fromJson(sessionStorage.getItem("cartForPaypal"));;//angular.fromJson(sessionStorage.getItem("cartForPaypal"));

                newOrder.customer = order.account;
                newOrder.customer.customerId = order.cart.customerId;
                newOrder.customer.id = order.cart.customerId;
                newOrder.currency = order.cart.currency;
                newOrder.payments = [];

                newOrder.billingAddress = {};
                newOrder.billingAddress.contactName = order.shipTo.contactName;
                newOrder.billingAddress.companyName = order.shipTo.companyName;
                newOrder.billingAddress.street = order.shipTo.address1;
                newOrder.billingAddress.extraLine1 = order.shipTo.address2;
                newOrder.billingAddress.city = order.shipTo.city;
                newOrder.billingAddress.state = order.shipTo.state;
                newOrder.billingAddress.zipCode = order.shipTo.zipCode;
                newOrder.billingAddress.country = order.shipTo.country;
                newOrder.billingAddress.contactPhone = order.shipTo.contactPhone;
                
                newOrder.shippingAddress = {};
                newOrder.shippingAddress.contactName = order.shipTo.contactName;
                newOrder.shippingAddress.companyName = order.shipTo.companyName;
                newOrder.shippingAddress.street = order.shipTo.address1;
                newOrder.shippingAddress.extraLine2 = order.shipTo.address2;
                newOrder.shippingAddress.city = order.shipTo.city;
                newOrder.shippingAddress.state = order.shipTo.state;
                newOrder.shippingAddress.zipCode = order.shipTo.zipCode;
                newOrder.shippingAddress.country = order.shipTo.country;
                newOrder.shippingAddress.contactPhone = order.shipTo.contactPhone;
                
                newOrder.subTotalPrice = order.cart.subTotalPrice.amount;
                newOrder.totalPrice = order.cart.totalPrice.amount;

                var itemsProcessed = 0;
                var orderDef = $q.defer();
                newOrder.entries = [];
                cartX.items.forEach((item, index, array) => {
                    itemsProcessed++;
                    var prod = {};
                    prod.product = {}; 
                    prod.id = item.product.product.id;
                    prod.amount = item.quantity;
                    prod.unitPrice = item.price.effectiveAmount;
                    prod.totalPrice = item.itemPrice.amount;
                    prod.product.name = item.product.product.name;
                    prod.product.description = item.product.product.description;
                    prod.product.sku = item.product.product.code;
                    prod.product.images = {};
                    prod.product.images = item.product.product.media;
                    newOrder.entries.push(prod);
                    if(itemsProcessed === array.length) {
                        itemsProcessed = -5;
                        orderDef.resolve();
                    };
                });

                

                var payments = {
                        status: "SUCCESS",
                        method: "PAYPAL",
                        paymentResponse: "",
                        paidAmount: newOrder.totalPrice,
                        currency: newOrder.currency
                    };

                newOrder.payments.push(payments);
                var orderComplate = $q.defer();
                if(itemsProcessed == -5){
                    $q.all(orderDef).then(function(){
                        return OrdersREST.Orders.all('orders').post(newOrder,undefined, undefined, {'Content-Type': 'application/json', 'hybris-user' : settings.hybrisUser, 'Authorization' : TokenSvc.getCustomToken().getAccessToken()}).then(function (order){
                            CartSvc.removeCart();
                            orderComplate.resolve(order);
                        });
                    });
                }
                return orderComplate.promise;
            },

            complateOrderWithPaypal : function(order, token){
                var self = this;
                var deferred = $q.defer();
                try {
                    $q.all(self.newCreateOrderForPayPal(order, token)).then(
                                // success handler
                                function (order) {
                                    deferred.resolve(order);
                                },
                                // error handler
                                function(errorResponse){
                                    var errMsg = '';                                    if(errorResponse.status === 500) {
                                        errMsg = 'Cannot process this order because the system is unavailable. Try again at a later time.';
                                    } else {
                                        errMsg = 'Order could not be processed.';
                                        if(errorResponse) {
                                            if(errorResponse.status) {
                                                errMsg += ' Status code: '+errorResponse.status+'.';
                                            }
                                            if(errorResponse.data && errorResponse.data.details && errorResponse.data.details.length) {
                                                angular.forEach(errorResponse.data.details, function (errorDetail) {
                                                    errMsg += ' ' + errorDetail.message;
                                                });
                                            }
                                        }
                                    }
                                    deferred.reject({ type: ERROR_TYPES.order, error: errMsg });
                                }
                            );
                }
                catch (error) {
                    console.error('Exception occurred during checkout: '+JSON.stringify(error));
                    error.type = 'payment_token_error';
                    deferred.reject({ type: ERROR_TYPES.paypal, error: error });
                }
                return deferred.promise;
            },

            resetCart: function () {
                CartSvc.resetCart();
            }

        };

    }]);
