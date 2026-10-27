-- DropForeignKey
ALTER TABLE "erp_sales_order_lines" DROP CONSTRAINT "erp_sales_order_lines_productId_fkey";

-- DropForeignKey
ALTER TABLE "erp_invoices" DROP CONSTRAINT "erp_invoices_orderId_fkey";

-- AddForeignKey
ALTER TABLE "erp_sales_order_lines" ADD CONSTRAINT "erp_sales_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "erp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_invoices" ADD CONSTRAINT "erp_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "erp_sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
