module multidriver (
    input  wire a,
    input  wire b,
    output wire y
);

    // Flaw: two continuous drivers on one net.
    assign y = a;
    assign y = b;

endmodule
