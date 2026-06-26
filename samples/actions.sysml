package OrderProcessing {
    doc /* アクションフローのサンプル。 */

    item def Order;
    item def Product;

    action def ProcessOrder {
        in item order : Order;
        out item product : Product;

        action validate {
            in item order : Order;
            out item checkedOrder : Order;
        }
        action manufacture {
            in item order : Order;
            out item product : Product;
        }
        action ship {
            in item product : Product;
            out item shippedProduct : Product;
        }

        first validate then manufacture;
        first manufacture then ship;

        bind validate.order = order;
        bind ship.shippedProduct = product;
        flow of Order from validate.checkedOrder to manufacture.order;
        flow of Product from manufacture.product to ship.product;
    }
}
