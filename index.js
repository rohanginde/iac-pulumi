const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");

const config = new pulumi.Config();

const availabilityZoneCount = config.getNumber("availabilityZoneCount");
const vpcCidrBlock = config.require("vpcCidrBlock");
const cidrBlock = config.require("cidrBlock");
const publicSubnets = [];
const privateSubnets = [];

const subnetSuffix = config.require("subnetSuffix");

const state = config.require("state");
const vpcName = config.require("vpcName");
const igwName = config.require("igwName");
const publicSta = config.require("public");

const destinationCidr = config.require("destinationCidr");
const public_route_association = config.require("public-route-association");
const private_route_association = config.require("private-route-association");
const privateSta = config.require("private");

const public_Subnet = config.require("publicsubnet");
const private_Subnet = config.require("privatesubnet");

const public_rt = config.require("public-rt");
const private_rt = config.require("private-rt");
const public_Route = config.require("publicRoute");
const owner = config.require("owner");

// Define a function to get the first N availability zones
function getFirstNAvailabilityZones(data, n) {
  const availableAZCount = data.names.length;

  if (availableAZCount >= n) {
    return data.names.slice(0, n);
  } else {
    return data.names;
  }
}

const availabilityZoneNames = []; // Initialize an array to store availability zone names
async function getAMIObject() {
  const latestAmi = await aws.ec2.getAmi({
    owners: [owner],
    filters: [
      {
        name: "state",
        values: ["available"],
      },
    ],

    mostRecent: true,
  });

  //const amiId =  await latestAmi.then(result => result.ids[0]);

  //logMessage(amiId)
  return latestAmi.id;
}
aws.getAvailabilityZones({ state: `${state}` }).then((data) => {
  const availabilityZones = getFirstNAvailabilityZones(
    data,
    availabilityZoneCount
  ); // Choose the first 3 AZs if available AZs are greater than 3
  const vpc = new aws.ec2.Vpc(`${vpcName}`, {
    cidrBlock: `${vpcCidrBlock}`,
    availabilityZones: availabilityZones,
  });
  const internetGateway = new aws.ec2.InternetGateway(`${igwName}`, {
    vpcId: vpc.id, // Associate the Internet Gateway with the VPC
  });

  for (let i = 0; i < availabilityZones.length; i++) {
    const az = availabilityZones[i];
    availabilityZoneNames.push(az);
  }
  const calculateCidrBlock = (index, subnetType) => {
    const subnetNumber =
      subnetType === `${publicSta}` ? index : index + availabilityZoneCount;
    return `${cidrBlock}.${subnetNumber}${subnetSuffix}`;
  };

  // Create subnets within each availability zone
  for (let i = 0; i < availabilityZoneNames.length; i++) {
    const az = availabilityZoneNames[i];

    // Create public and private subnets using aws.ec2.Subnet
    const publicSubnet = new aws.ec2.Subnet(`${public_Subnet}-${az}-${i}`, {
      vpcId: vpc.id,
      cidrBlock: calculateCidrBlock(i, `${publicSta}`),
      availabilityZone: az,
      mapPublicIpOnLaunch: true,
      tags: {
        Name: `${public_Subnet}`,
      },
    });

    const privateSubnet = new aws.ec2.Subnet(`${private_Subnet}-${az}-${i}`, {
      vpcId: vpc.id,
      cidrBlock: calculateCidrBlock(i, `${privateSta}`),
      availabilityZone: az,
      tags: {
        Name: `${private_Subnet}`,
      },
    });

    publicSubnets.push(publicSubnet);
    privateSubnets.push(privateSubnet);
  }

  const publicRouteTable = new aws.ec2.RouteTable(`${public_rt}`, {
    vpcId: vpc.id,
    tags: {
      Name: `${public_rt}`,
    },
  });

  const privateRouteTable = new aws.ec2.RouteTable(`${private_rt}`, {
    vpcId: vpc.id,
    tags: {
      Name: `${private_rt}`,
    },
  });
  const publicRoute = new aws.ec2.Route(`${public_Route}`, {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: `${destinationCidr}`,
    gatewayId: internetGateway.id,
  });

  // Associate the public subnets with the public route table
  publicSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(
      `${public_route_association}-${subnet.availabilityZone}-${i}`,
      {
        subnetId: subnet.id,
        routeTableId: publicRouteTable.id,
        tags: {
          Name: `${public_route_association}`,
        },
      }
    );
  });

  // Associate the private subnets with the private route table
  privateSubnets.forEach((subnet, i) => {
    new aws.ec2.RouteTableAssociation(
      `${private_route_association}-${subnet.availabilityZone}-${i}`,
      {
        subnetId: subnet.id,
        routeTableId: privateRouteTable.id,
        tags: {
          Name: `${private_route_association}`,
        },
      }
    );
  });

  const vpcId = vpc.id;

  // Define the name for the EC2 instance
  const instanceName = "MyEC2Instance";

  // Create a new security group for the load balancer
  const loadBalancerSecurityGroup = new aws.ec2.SecurityGroup(
    "LoadBalancerSecurityGroup",
    {
      vpcId: vpc.id,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 80,
          toPort: 80,
          cidrBlocks: ["0.0.0.0/0"], // Allow traffic from anywhere (you may want to restrict this in production)
        },
        {
          protocol: "tcp",
          fromPort: 443,
          toPort: 443,
          cidrBlocks: ["0.0.0.0/0"], // Allow traffic from anywhere (you may want to restrict this in production)
        },

      ],
      egress:[
        {
          protocol: "-1",
          fromPort: 0,
          toPort:   0,
          cidrBlocks: ["0.0.0.0/0"], 
        }
      ]
    }
  );
 
  // Create a security group for the EC2 instance
  const securityGroup = new aws.ec2.SecurityGroup(
    "application-security-group",
    {
     
      vpcId: vpc.id,
      ingress: [
        {
          fromPort: 22,
          toPort: 22,
          protocol: "tcp",
          securityGroups: [loadBalancerSecurityGroup.id.apply(id=>id)], // Allow SSH traffic from the Load Balancer Security Group
        },
        {
          fromPort: 3000, // Replace with the actual port your application runs on
          toPort: 3000, // Replace with the actual port your application runs on
          protocol: "tcp",
          securityGroups: [loadBalancerSecurityGroup.id.apply(id=>id)], // Allow your application traffic from the Load Balancer Security Group
        },
      ],
      egress: [
        {
          fromPort: 3306, // Allow outbound traffic on port 3306
          toPort: 3306, // Allow outbound traffic on port 3306
          protocol: "tcp", // TCP protocol
          cidrBlocks: ["0.0.0.0/0"], // Allow all destinations
        },
        {
          fromPort: 443, // Allow outbound traffic on port 3306
          toPort: 443, // Allow outbound traffic on port 3306
          protocol: "tcp", // TCP protocol
          cidrBlocks: ["0.0.0.0/0"], // Allow all destinations
        },
      ],
    },{
      dependsOn: [loadBalancerSecurityGroup], // Specify the dependency on another security group
    }
  );

  const dbSecGroup = new aws.ec2.SecurityGroup("db-sg", {
    vpcId: vpc.id,
    ingress: [
      {
        fromPort: 3306, // For MariaDB
        toPort: 3306, // For MariaDB
        protocol: "tcp",
        securityGroups: [securityGroup.id], // Referencing the application security group as source
      },
    ],
    egress: [
      {
        fromPort: 0,
        toPort: 0,
        protocol: "-1",
        cidrBlocks: ["0.0.0.0/0"],
      },
    ],
  },{
    dependsOn: [securityGroup], // Specify the dependency on another security group
  });

  const rdsSubnetGroup = new aws.rds.SubnetGroup("myrdsgroup", {
    subnetIds: privateSubnets.map((subnet) => subnet.id),
    description: "My RDS subnet group for private subnets",
  });



  const rdsParameterGroup = new aws.rds.ParameterGroup("customrdsparamgroup", {
    family: "mysql8.0", // Replace with the appropriate RDS engine and version
    parameters: [
      {
        name: "max_connections",
        value: "100",
      },
      // Add more parameters as needed
    ],
  });



  const rdsParameterGroupName = rdsParameterGroup.name;

  const rdsInstance = new aws.rds.Instance("rdsinstance", {
    allocatedStorage: 20, // You can adjust the storage size as needed
    storageType: "gp2",
    engine: "mysql", // Replace with "postgresql" or "mariadb" as needed
    instanceClass: "db.t2.micro", // Use the desired instance class
    name: "csye6225",
    username: "csye6225",
    password: "masterpass", // Replace with a strong password
    skipFinalSnapshot: true,
    publiclyAccessible: false,
    multiAz: false,
    vpcSecurityGroupIds: [dbSecGroup.id], // Attach the Database Security Group created earlier
    dbSubnetGroupName: rdsSubnetGroup, // Replace with your RDS subnet group
    parameterGroupName: rdsParameterGroup, // Replace with your custom RDS parameter group
  });

  const cloudAgentIAMRole = new aws.iam.Role("cloudAgentIAMRole", {
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            Service: "ec2.amazonaws.com",
          },
        },
      ],
    }),
  });

  // Attach a predefined AWS managed policy to the role
  const policyArn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"; // Replace with the desired policy ARN

  const rolePolicyAttachment = new aws.iam.PolicyAttachment(
    "myIamRoleAttachment",
    {
      policyArn: policyArn,
      roles: [cloudAgentIAMRole.name],
    }
  );

  // You can attach additional policies to the role if needed

  const instanceProfile = new aws.iam.InstanceProfile("instanceProfileName", {
    role: cloudAgentIAMRole.name,
  });


  const dynamicString = pulumi.interpolate 
  `#!/bin/bash
  cd /opt/csye6225/
  chmod +w .env
  editable_file=".env"  
  mysql_database=${rdsInstance.dbName}
  mysql_user=${rdsInstance.username}
  mysql_password=${rdsInstance.password}
  mysql_port=${rdsInstance.port}
  mysql_host=${rdsInstance.address}
  db_dialect=${rdsInstance.engine}
  if [ -f "$editable_file" ]; then
     
  > "$editable_file"
 
      # Add new key-value pairs
      echo "MYSQL_DATABASE=$mysql_database" >> "$editable_file"
      echo "MYSQL_USER=$mysql_user" >> "$editable_file"
      echo "MYSQL_PASSWORD=$mysql_password" >> "$editable_file"
      echo "MYSQL_PORT=$mysql_port" >> "$editable_file"
      echo "MYSQL_HOST=$mysql_host" >> "$editable_file"
      echo "DB_DIALECT=$db_dialect" >> "$editable_file"
 
      echo "Cleared old data in $editable_file and added new key-value pairs."
  else
      echo "File $editable_file does not exist."
  fi
  sudo chown -R csye6225:csye6225 /opt/csye6225

  sudo chmod 750 /opt/csye6225
  # Enable the CloudWatch Agent service
  sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl  -a fetch-config -m ec2 -c file:/opt/csye6225/cloudwatch-config.json -s
  sudo systemctl enable amazon-cloudwatch-agent
  sudo systemctl start  amazon-cloudwatch-agent
  sudo systemctl restart  amazon-cloudwatch-agent
  `







  const launchTemplate = new aws.ec2.LaunchTemplate("my-launch-template", {
    imageId: getAMIObject(),
    instanceType: "t2.micro",
    dependsOn: rdsInstance,
    keyName: "ec2-instance-us-east-1",
    userData: dynamicString.apply(script=>Buffer.from(script).toString("base64")),
   

    iamInstanceProfile: {
      name: instanceProfile.name,
    },
    associatePublicIpAddress: true,
    networkInterfaces: [
      {
          securityGroups: [securityGroup.id],
      },
  ],
  },{dependsOn:[instanceProfile,rdsInstance]});
  

  const targetGroup = new aws.lb.TargetGroup("my-target-group", {
    port: 3000, // Replace with the port your application listens on
    protocol: "HTTP",
    targetType: "instance",
    vpcId: vpc.id,
    associatePublicIpAddress:true,
    healthCheck:{
      path: "/healthz", 
      port: 3000,
      protocol: "HTTP",
      timeout: 10,
      unhealthyThreshold: 2,
      healthyThreshold: 2,

  },
  });


  // Fetch the region and operating system from the loaded configuration

  const alb = new aws.lb.LoadBalancer("webapp-alb", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [loadBalancerSecurityGroup.id],
    subnets: publicSubnets,
  });

 
  // Create a listener for HTTP traffic on port 80
const listener = new aws.lb.Listener("my-listener", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [
      {
          type: "forward",
          targetGroupArn: targetGroup.arn,
      },
  ],
},{dependsOn: alb});






  // Create an Auto Scaling Group
  const autoScalingGroup = new aws.autoscaling.Group("my-asg", {
    vpc:vpc.id,
    vpcZoneIdentifiers: publicSubnets, // You may adjust this based on your VPC configuration
    launchTemplate: {
      id: launchTemplate.id,
      version: "$Latest",
    },
    minSize: 1,
    maxSize: 3,
    desiredCapacity: 1,
    cooldown: 60,
    launchConfigurationName: "asg_launch_config",
    tags: [
      {
        key: "AutoScalingGroup",
        value: "WebAppASG",
        propagateAtLaunch: true,
      },
    ],
    targetGroupArns:[targetGroup.arn]
  }, {dependsOn: [listener]});

  // Create scaling policies
  const scaleUpPolicy = new aws.autoscaling.Policy("scale-up-policy", {
    autoscalingGroupName: autoScalingGroup.name,
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    metricAggregationType: "Average",
    name: "scale-up-policy",
    scalingTargetId: autoScalingGroup.id,
  });

  const scaleDownPolicy = new aws.autoscaling.Policy("scale-down-policy", {
    autoscalingGroupName: autoScalingGroup.name,
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60,
    metricAggregationType: "Average",
    name: "scale-down-policy",
    scalingTargetId: autoScalingGroup.id,
  });

  // Create an Application Load Balancer

  // const ec2Instance = new aws.ec2.Instance(instanceName, {
  //   ami: getAMIObject(), // Replace 'your_custom_ami_id' with the ID of your custom AMI.
  //   instanceType: "t2.micro", // Replace with the desired instance type.
  //   vpcSecurityGroupIds: [securityGroup.id],
  //   dependsOn:rdsInstance,
  //   iamInstanceProfile: instanceProfile,
  //   userData:pulumi.interpolate `
  //       #!/bin/bash
  //       cd /opt/csye6225/
  //       chmod +w .env
  //       editable_file=".env"
  //       mysql_database=${rdsInstance.dbName}
  //       mysql_user=${rdsInstance.username}
  //       mysql_password=${rdsInstance.password}
  //       mysql_port=${rdsInstance.port}
  //       mysql_host=${rdsInstance.address}
  //       db_dialect=${rdsInstance.engine}
  //       if [ -f "$editable_file" ]; then

  //       > "$editable_file"

  //           # Add new key-value pairs
  //           echo "MYSQL_DATABASE=$mysql_database" >> "$editable_file"
  //           echo "MYSQL_USER=$mysql_user" >> "$editable_file"
  //           echo "MYSQL_PASSWORD=$mysql_password" >> "$editable_file"
  //           echo "MYSQL_PORT=$mysql_port" >> "$editable_file"
  //           echo "MYSQL_HOST=$mysql_host" >> "$editable_file"
  //           echo "DB_DIALECT=$db_dialect" >> "$editable_file"

  //           echo "Cleared old data in $editable_file and added new key-value pairs."
  //       else
  //           echo "File $editable_file does not exist."
  //       fi
  //       sudo chown -R csye6225:csye6225 /opt/csye6225

  //       sudo chmod 750 /opt/csye6225
  //       # Enable the CloudWatch Agent service
  //       sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl  -a fetch-config -m ec2 -c file:/opt/csye6225/cloudwatch-config.json -s
  //       sudo systemctl enable amazon-cloudwatch-agent
  //       sudo systemctl start  amazon-cloudwatch-agent
  //       sudo systemctl restart  amazon-cloudwatch-agent
  //       `.apply(s => s.trim()),
  //   associatePublicIpAddress: true,
  //   subnetId: publicSubnets[0].id,
  //   // Replace 'your_subnet_id' with the desired subnet ID.
  //   keyName: "ec2-instance-us-east-1",
  //   tags: { Name: instanceName },
  //   rootBlockDevice: {
  //     volumeSize: 25, // Replace with the desired root volume size (in GB).
  //     volumeType: "gp2", // Specify the root volume type as General Purpose SSD (GP2).
  //     deleteOnTermination: true, // Protect against accidental termination by setting this to false.
  //   },
  // });



 

  //Adding a record

  const domainName = "dev.rohanswebapp.me";

  const hostedZone = aws.route53.getZone({
    name: domainName,
  });

  // After the promise is fulfilled, create a Route 53 A record pointing to the load balancer
  hostedZone.then(zone => {
    const port = 3000;
  
    const aRecord = new aws.route53.Record('csye-6225', {
      name: domainName,
      zoneId: zone.id,
      type: 'A',
      aliases: [
        {
          name: alb.dnsName,
          zoneId: alb.zoneId,
          evaluateTargetHealth: true,
        },
      ]
  });
  
  
  }, { dependsOn: [alb] });
});
