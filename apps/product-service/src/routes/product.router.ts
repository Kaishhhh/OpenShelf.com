import { Router } from 'express';
import {
  isSellerAuthenticated,
  requireApprovedShop,
} from '@openshelf/middleware';
import {
  addProductImage,
  createProduct,
  deleteProduct,
  deleteProductImage,
  getProduct,
  getPublicProductBySlug,
  listPublicProducts,
  getUploadAuth,
  listMyProducts,
  updateProduct,
} from '../controllers/product.controller.js';

export const productRouter = Router();

const sellerOnly = [isSellerAuthenticated, requireApprovedShop];

// Route order matters: '/public/:slug', '/mine' and '/upload-auth' are
// literal-prefixed and must be registered before '/:id', which would otherwise
// match them first.
// A bare '/public' MUST stay above '/:id' below: '/:id' is a single-segment
// param wrapped in sellerOnly, so it would swallow this literal and answer 401
// to anonymous visitors rather than 404. '/public/:slug' is two segments and
// cannot shadow it in either order.
productRouter.get('/public', listPublicProducts);
productRouter.get('/public/:slug', getPublicProductBySlug);

productRouter.post('/', ...sellerOnly, createProduct);
productRouter.get('/mine', ...sellerOnly, listMyProducts);
productRouter.get('/upload-auth', ...sellerOnly, getUploadAuth);
productRouter.get('/:id', ...sellerOnly, getProduct);
productRouter.patch('/:id', ...sellerOnly, updateProduct);
productRouter.delete('/:id', ...sellerOnly, deleteProduct);

// Safe below '/:id' — these carry extra path segments, so '/:id' can't swallow
// them the way it would a bare literal.
productRouter.post('/:id/images', ...sellerOnly, addProductImage);
productRouter.delete('/:id/images/:imageId', ...sellerOnly, deleteProductImage);
